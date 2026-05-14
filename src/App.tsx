import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  Download,
  Code, 
  Check, 
  Copy, 
  Monitor,
  RefreshCw,
  Layers,
  ExternalLink,
  FlipHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RESIZE_FORMATS, ResizeFormat } from './types';
import { resizeImage } from './utils/imageProcessing';
import { trackEvent, db, handleFirestoreError, OperationType } from './firebase';
import { onSnapshot, doc } from 'firebase/firestore';

interface PreviewContainerProps {
  formatId: string;
  draggingFormatId: string | null;
  aspectRatio: number;
  handlePreviewMouseDown: (e: React.MouseEvent, formatId: string) => void;
  handleWheel: (e: WheelEvent, formatId: string) => void;
  children: React.ReactNode;
}

function PreviewContainer({ formatId, draggingFormatId, aspectRatio, handlePreviewMouseDown, handleWheel, children }: PreviewContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onWheelInternal = (e: WheelEvent) => {
      handleWheel(e, formatId);
    };

    element.addEventListener('wheel', onWheelInternal, { passive: false });
    return () => element.removeEventListener('wheel', onWheelInternal);
  }, [formatId, handleWheel]);

  return (
    <div 
      ref={containerRef}
      onMouseDown={(e) => handlePreviewMouseDown(e, formatId)}
      className={`w-full bg-black/40 border border-bento-border overflow-hidden flex items-center justify-center relative shrink-0 transition-colors ${draggingFormatId === formatId ? 'cursor-grabbing border-bento-accent' : 'cursor-grab hover:border-bento-accent'}`}
      style={{ aspectRatio: String(aspectRatio) }}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [masterImage, setMasterImage] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [customBaseName, setCustomBaseName] = useState<string>('');
  const [resizedImages, setResizedImages] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [formats, setFormats] = useState<ResizeFormat[]>(RESIZE_FORMATS);
  const [masterDimensions, setMasterDimensions] = useState({ width: 0, height: 0 });
  const masterImageElementRef = useRef<HTMLImageElement | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const [draggingFormatId, setDraggingFormatId] = useState<string | null>(null);
  const [previewDragStart, setPreviewDragStart] = useState({ x: 0, y: 0 });
  const [draggedRect, setDraggedRect] = useState<DOMRect | null>(null);
  
  // Selection area is now just a static default for internal compatibility
  const defaultSelection = { x: 0.5, y: 0.5, width: 0, height: 0 };
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [adminStats, setAdminStats] = useState<{ total_exports: number, total_request_clicks: number, last_updated?: any } | null>(null);
  const logoClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const logoClickCount = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to stats if admin is open
  React.useEffect(() => {
    if (!isAdminOpen) return;
    const unsub = onSnapshot(
      doc(db, 'system', 'stats'), 
      (snapshot) => {
        if (snapshot.exists()) {
          setAdminStats(snapshot.data() as any);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'system/stats');
      }
    );
    return () => unsub();
  }, [isAdminOpen]);

  const handleLogoClick = useCallback(() => {
    logoClickCount.current += 1;
    
    if (logoClickTimeoutRef.current) clearTimeout(logoClickTimeoutRef.current);
    
    if (logoClickCount.current >= 5) {
      setIsAdminOpen(true);
      logoClickCount.current = 0;
    } else {
      logoClickTimeoutRef.current = setTimeout(() => {
        logoClickCount.current = 0;
      }, 2000);
    }
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const generateResizedVersions = useCallback(async (
    imageSrc: string, 
    currentFormats = formats, 
    singleFormatId?: string,
    preloadedImage?: HTMLImageElement
  ) => {
    if (!singleFormatId) setIsProcessing(true);
    
    let img = preloadedImage || masterImageElementRef.current;
    
    if (!img) {
      img = new Image();
      img.src = imageSrc;
      await new Promise((resolve) => {
        img!.onload = resolve;
      });
      masterImageElementRef.current = img;
    }

    const formatsToProcess = singleFormatId 
      ? currentFormats.filter(f => f.id === singleFormatId)
      : currentFormats;

    const generationTasks = formatsToProcess.map(async (format) => {
      const dataUrl = await resizeImage(img!, format, defaultSelection);
      return { id: format.id, dataUrl };
    });

    const taskResults = await Promise.all(generationTasks);
    
    setResizedImages(prev => {
      const newResults = { ...prev };
      taskResults.forEach(({ id, dataUrl }) => {
        newResults[id] = dataUrl;
      });
      return newResults;
    });
    
    if (!singleFormatId) setIsProcessing(false);
  }, [formats]);

  const processFile = useCallback((file: File) => {
    setOriginalFile(file);
    setCustomBaseName(file.name.split('.')[0]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setMasterImage(result);
      
      const img = new Image();
      img.onload = async () => {
        masterImageElementRef.current = img;
        setMasterDimensions({ width: img.width, height: img.height });
        generateResizedVersions(result, formats, undefined, img);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  }, [formats, generateResizedVersions]);

  const toggleMirror = useCallback((formatId: string) => {
    const newFormats = formats.map(f => 
      f.id === formatId ? { ...f, mirror: !f.mirror } : f
    );
    setFormats(newFormats);
    
    if (masterImage) {
      generateResizedVersions(masterImage, newFormats);
    }
  }, [formats, masterImage, generateResizedVersions]);

  const getInitialAdjustmentValues = useCallback((format: ResizeFormat) => {
    if (format.customOffset && format.customScale) {
      return { offset: format.customOffset, scale: format.customScale };
    }

    if (!masterImage || masterDimensions.width === 0) return { offset: { x: 0, y: 0 }, scale: 1 };

    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;

    let scale = 1;
    let offset = { x: 0, y: 0 };

    if (imgRatio > targetRatio) {
      const sourceWidth = imgHeight * targetRatio;
      scale = imgWidth / sourceWidth;
      offset.x = ((imgWidth - sourceWidth) / 2 / imgWidth) * scale;
      offset.y = 0;
    } else {
      const sourceHeight = imgWidth / targetRatio;
      scale = 1;
      let sourceY = (imgHeight - sourceHeight) / 2;
      offset.x = 0;
      offset.y = (sourceY / sourceHeight);
    }

    return { offset, scale };
  }, [masterImage, masterDimensions]);

  const handleZoom = useCallback((formatId: string, delta: number) => {
    const format = formats.find(f => f.id === formatId);
    if (!format) return;

    const currentValues = getInitialAdjustmentValues(format);
    const oldScale = currentValues.scale;
    
    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;

    const aspectX = imgRatio > targetRatio ? imgRatio / targetRatio : 1;
    const aspectY = imgRatio < targetRatio ? targetRatio / imgRatio : 1;
    
    const minScale = 1;
    const newScale = Math.max(minScale, Math.min(10, oldScale + delta));
    
    if (newScale === oldScale) return;

    // Zoom towards the center of the visible area
    const scaleRatio = newScale / oldScale;
    const newOffsetX = (currentValues.offset.x + 0.5) * scaleRatio - 0.5;
    const newOffsetY = (currentValues.offset.y + 0.5) * scaleRatio - 0.5;

    const maxOffsetX = Math.max(0, aspectX * newScale - 1);
    const maxOffsetY = Math.max(0, aspectY * newScale - 1);
    
    const newOffset = {
      x: Math.max(0, Math.min(maxOffsetX, newOffsetX)),
      y: Math.max(0, Math.min(maxOffsetY, newOffsetY))
    };

    const newFormats = formats.map(f => 
      f.id === formatId ? { ...f, customOffset: newOffset, customScale: newScale } : f
    );
    setFormats(newFormats);
    
    if (masterImage) {
      // PERFORMANCE: Only update the specific format being zoomed
      generateResizedVersions(masterImage, newFormats, formatId);
    }
  }, [formats, getInitialAdjustmentValues, masterDimensions, masterImage, generateResizedVersions]);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent, formatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingFormatId(formatId);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });
    setDraggedRect(e.currentTarget.getBoundingClientRect());
  }, []);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingFormatId || !masterImage || !draggedRect) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < 16) return;
    lastUpdateRef.current = now;

    const format = formats.find(f => f.id === draggingFormatId);
    if (!format) return;

    const currentValues = getInitialAdjustmentValues(format);
    
    const dx = (e.clientX - previewDragStart.x) / draggedRect.width;
    const dy = (e.clientY - previewDragStart.y) / draggedRect.height;

    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;

    const aspectX = imgRatio > targetRatio ? imgRatio / targetRatio : 1;
    const aspectY = imgRatio < targetRatio ? targetRatio / imgRatio : 1;

    // Offset in terms of fraction of the visible width/height
    let newOffsetX = currentValues.offset.x - dx;
    let newOffsetY = currentValues.offset.y - dy;

    const maxOffsetX = Math.max(0, aspectX * currentValues.scale - 1);
    const maxOffsetY = Math.max(0, aspectY * currentValues.scale - 1);

    const newOffset = { 
      x: Math.max(0, Math.min(maxOffsetX, newOffsetX)), 
      y: Math.max(0, Math.min(maxOffsetY, newOffsetY)) 
    };

    const newFormats = formats.map(f => 
      f.id === draggingFormatId ? { ...f, customOffset: newOffset, customScale: currentValues.scale } : f
    );
    
    setFormats(newFormats);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });

    generateResizedVersions(masterImage, newFormats, draggingFormatId);
  }, [draggingFormatId, masterImage, draggedRect, formats, getInitialAdjustmentValues, previewDragStart, masterDimensions, generateResizedVersions]);

  const handlePreviewMouseUp = useCallback(() => {
    setDraggingFormatId(null);
    setDraggedRect(null);
  }, []);

  const handleWheel = useCallback((e: WheelEvent, formatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Use a logarithmic-feeling step for smoother scaling
    const delta = e.deltaY * -0.0012;
    handleZoom(formatId, delta);
  }, [handleZoom]);

  const downloadAll = useCallback(async () => {
    trackEvent('export', 5);
    Object.entries(resizedImages).forEach(([id, dataUrl]) => {
      const format = RESIZE_FORMATS.find(f => f.id === id);
      if (format && typeof dataUrl === 'string') {
        const link = document.createElement('a');
        link.href = dataUrl;
        const baseName = (customBaseName || (originalFile ? originalFile.name.split('.')[0] : 'image')).replace(/\s+/g, '');
        const formatStr = `${format.width}x${format.height}`;
        const suffix = format.focus === 'left' ? '_left' : '';
        link.download = `${formatStr}_${baseName}${suffix}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
  }, [resizedImages, customBaseName, originalFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  }, [processFile]);

  return (
    <div 
      className="min-h-screen flex flex-col bg-bento-bg"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="h-16 px-6 flex items-center border-b border-bento-border bg-bento-card relative">
        <div className="flex items-center gap-3 cursor-pointer select-none" onClick={handleLogoClick}>
          <div className="w-6 h-6 bg-bento-accent flex items-center justify-center shadow-lg shadow-bento-accent/20">
            <Layers className="text-white w-4 h-4" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Master Resizer <span className="font-light opacity-50">v2.4.0</span></h1>
        </div>

        {/* Centered Request Link - Appears only when masterImage is loaded */}
        {masterImage && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <a 
              href="https://pvcpgroup.atlassian.net/jira/core/projects/ST/form/3?atlOrigin=eyJpIjoiYzYwZGM3OWUyMjljNDhhNGI5M2ZhOGMyZTJmYTYwYzkiLCJwIjoiaiJ9" 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={() => trackEvent('request_click')}
              className="bento-btn flex items-center gap-2 whitespace-nowrap shadow-lg shadow-bento-accent/10"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Click here to fill a Studio Request for any problem
            </a>
          </div>
        )}

        <div className="ml-auto flex items-center gap-4">
          {masterImage && (
            <>
              <span className="text-[10px] uppercase tracking-widest text-bento-dim font-bold">Status: Ready</span>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bento-btn-outline flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Change
              </button>
              <button 
                onClick={downloadAll}
                className="bento-btn flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                Export All
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {!masterImage ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="h-full flex flex-col items-center justify-center p-8"
          >
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-2xl aspect-video bento-card border-dashed border-2 border-bento-border hover:border-bento-accent transition-all cursor-pointer flex flex-col items-center justify-center group"
            >
              <div className="w-16 h-16 bg-bento-accent/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                <Upload className="w-6 h-6 text-bento-accent" />
              </div>
              <h2 className="text-xl font-bold mb-2">Drop your Master image</h2>
              <p className="text-bento-dim text-sm text-center max-w-xs">
                High resolution format recommended for optimal variations.
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="max-w-7xl mx-auto w-full p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8 bg-bento-card p-6 border border-bento-border shadow-xl">
              <div className="flex flex-col gap-1 w-full md:w-auto">
                <span className="text-[10px] uppercase tracking-widest text-bento-dim font-bold">Visual Name</span>
                <input 
                  type="text" 
                  value={customBaseName}
                  onChange={(e) => setCustomBaseName(e.target.value)}
                  className="bg-bento-bg border border-bento-border focus:border-bento-accent outline-none text-sm font-bold py-2 px-4 min-w-[300px] transition-all"
                  placeholder="Enter image name..."
                />
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={downloadAll}
                  className="bento-btn flex items-center gap-2 h-11 px-6 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download All Formats
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 select-none"
                 onMouseMove={handlePreviewMouseMove}
                 onMouseUp={handlePreviewMouseUp}
                 onMouseLeave={handlePreviewMouseUp}>
              {formats.map((format) => (
                <motion.div 
                  key={format.id} 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-bento-card border border-bento-border p-4 flex flex-col gap-4 group hover:border-bento-accent/50 transition-all shadow-lg hover:shadow-2xl hover:shadow-bento-accent/5"
                >
                  <PreviewContainer
                    formatId={format.id}
                    draggingFormatId={draggingFormatId}
                    aspectRatio={format.width / format.height}
                    handlePreviewMouseDown={handlePreviewMouseDown}
                    handleWheel={handleWheel}
                  >
                    {resizedImages[format.id] ? (
                      <img 
                        src={resizedImages[format.id]} 
                        alt={format.name} 
                        className="w-full h-full object-cover pointer-events-none select-none" 
                        draggable={false}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 opacity-20">
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        <span className="text-[10px] font-bold">RESIZING...</span>
                      </div>
                    )}
                    
                    {format.overlay && (
                      <div 
                        className="absolute pointer-events-none z-10"
                        style={format.overlay.style}
                      />
                    )}
                  </PreviewContainer>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold truncate">{format.name}</h3>
                        <p className="text-[10px] font-mono text-bento-dim uppercase tracking-wider">{format.width}x{format.height}</p>
                      </div>
                      <a 
                        href={resizedImages[format.id]} 
                        download={`${format.width}x${format.height}_${(customBaseName || (originalFile ? originalFile.name.split('.')[0] : 'image')).replace(/\s+/g, '')}.jpg`}
                        className="p-2 bg-bento-accent/10 text-bento-accent hover:bg-bento-accent hover:text-white transition-all shadow-sm"
                        title="Download this format"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-bento-border">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => toggleMirror(format.id)}
                          className={`p-2 border transition-all ${
                            format.mirror 
                              ? 'bg-bento-accent/20 border-bento-accent text-bento-accent shadow-inner shadow-bento-accent/10' 
                              : 'border-bento-border text-bento-dim hover:border-bento-accent hover:text-white'
                          }`}
                          title="Mirror View"
                        >
                          <FlipHorizontal className="w-4 h-4" />
                        </button>

                        {resizedImages[format.id] && (
                          <div className="flex flex-col">
                            <span className="text-[9px] uppercase tracking-tighter text-bento-dim font-bold">Est. Weight</span>
                            <span className="text-[11px] font-mono font-bold text-bento-accent">
                              {(() => {
                                const base64 = resizedImages[format.id].split(',')[1];
                                if (!base64) return '0 KB';
                                const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
                                const size = (base64.length * 0.75) - padding;
                                return `${Math.round(size / 1024)} KB`;
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 bg-bento-bg border border-bento-border p-1">
                        <button 
                          onClick={() => handleZoom(format.id, -0.1)}
                          className="w-8 h-8 flex items-center justify-center hover:bg-white/5 text-bento-dim hover:text-white transition-colors text-lg font-bold"
                        >
                          -
                        </button>
                        <span className="text-[11px] font-mono w-10 text-center font-bold">
                          {Math.round((format.customScale || getInitialAdjustmentValues(format).scale) * 100)}%
                        </span>
                        <button 
                          onClick={() => handleZoom(format.id, 0.1)}
                          className="w-8 h-8 flex items-center justify-center hover:bg-white/5 text-bento-dim hover:text-white transition-colors text-lg font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Admin Panel Overlay */}
      <AnimatePresence>
        {isAdminOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bento-card max-w-md w-full p-6 space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-bento-accent" />
                  Admin Dashboard
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      // Manual trigger to refresh by toggle
                      setIsAdminOpen(false);
                      setTimeout(() => setIsAdminOpen(true), 10);
                    }}
                    className="p-1 hover:bg-white/10 transition-colors group"
                    title="Force Refresh"
                  >
                    <RefreshCw className="w-4 h-4 text-bento-dim group-active:rotate-180 transition-transform duration-500" />
                  </button>
                  <button 
                    onClick={() => setIsAdminOpen(false)}
                    className="p-2 hover:bg-white/10 transition-colors text-bento-dim hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-bento-bg p-4 border border-bento-border text-center">
                  <div className="text-2xl font-bold text-bento-accent">
                    {adminStats?.total_exports || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-bento-dim font-bold mt-1">
                    Total Exports
                  </div>
                </div>
                <div className="bg-bento-bg p-4 border border-bento-border text-center">
                  <div className="text-2xl font-bold text-bento-accent">
                    {adminStats?.total_request_clicks || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-bento-dim font-bold mt-1">
                    Studio Requests
                  </div>
                </div>
              </div>

              {adminStats?.last_updated && (
                <div className="text-center">
                  <span className="text-[9px] text-bento-dim uppercase tracking-tighter">
                    Sync Live — Last data: {new Date(adminStats.last_updated.seconds * 1000).toLocaleTimeString()}
                  </span>
                </div>
              )}

              <button 
                onClick={() => setIsAdminOpen(false)}
                className="bento-btn w-full"
              >
                Close Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="image/*" 
        className="hidden" 
      />
    </div>
  );
}
