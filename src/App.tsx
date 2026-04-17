import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  Download, 
  Code, 
  Check, 
  Copy, 
  RefreshCw,
  Layers,
  Monitor,
  Square,
  Layout,
  ChevronRight,
  FlipHorizontal,
  Move,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RESIZE_FORMATS, ResizeFormat, SelectionArea } from './types';
import { resizeImage } from './utils/imageProcessing';
import { trackEvent, db, handleFirestoreError, OperationType } from './firebase';
import { onSnapshot, doc } from 'firebase/firestore';

export default function App() {
  const [masterImage, setMasterImage] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [customBaseName, setCustomBaseName] = useState<string>('');
  const [resizedImages, setResizedImages] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectionArea, setSelectionArea] = useState<SelectionArea>({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredFormat, setHoveredFormat] = useState<ResizeFormat | null>(null);
  const [formats, setFormats] = useState<ResizeFormat[]>(RESIZE_FORMATS);
  const [masterDimensions, setMasterDimensions] = useState({ width: 0, height: 0 });
  const [draggingFormatId, setDraggingFormatId] = useState<string | null>(null);
  const [previewDragStart, setPreviewDragStart] = useState({ x: 0, y: 0 });
  const [draggedRect, setDraggedRect] = useState<DOMRect | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const masterImageElementRef = useRef<HTMLImageElement | null>(null);
  
  // Admin State
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [adminStats, setAdminStats] = useState<{ total_exports: number, total_request_clicks: number, last_updated?: any } | null>(null);
  const logoClickCount = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

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

  const handleLogoClick = () => {
    logoClickCount.current += 1;
    if (logoClickCount.current >= 5) {
      setIsAdminOpen(true);
      logoClickCount.current = 0;
    }
    // Reset click count after 3 seconds of inactivity
    setTimeout(() => {
      logoClickCount.current = 0;
    }, 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = useCallback((file: File) => {
    setOriginalFile(file);
    setCustomBaseName(file.name.split('.')[0]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setMasterImage(result);
      
      const img = new Image();
      img.onload = () => {
        masterImageElementRef.current = img;
        setMasterDimensions({ width: img.width, height: img.height });
        const initialSelection = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
        setSelectionArea(initialSelection);
        generateResizedVersions(result, initialSelection, formats, undefined, img);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  }, [formats]);

  const generateResizedVersions = useCallback(async (
    imageSrc: string, 
    area = selectionArea, 
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

    const results: Record<string, string> = { ...resizedImages };
    const formatsToProcess = singleFormatId 
      ? currentFormats.filter(f => f.id === singleFormatId)
      : currentFormats;

    const generationTasks = formatsToProcess.map(async (format) => {
      const dataUrl = await resizeImage(img!, format, area);
      return { id: format.id, dataUrl };
    });

    const taskResults = await Promise.all(generationTasks);
    taskResults.forEach(({ id, dataUrl }) => {
      results[id] = dataUrl;
    });
    
    setResizedImages(results);
    if (!singleFormatId) setIsProcessing(false);
  }, [selectionArea, formats, resizedImages]);

  const toggleMirror = useCallback((formatId: string) => {
    const newFormats = formats.map(f => 
      f.id === formatId ? { ...f, mirror: !f.mirror } : f
    );
    setFormats(newFormats);
    
    if (masterImage) {
      generateResizedVersions(masterImage, selectionArea, newFormats);
    }
  }, [formats, masterImage, selectionArea, generateResizedVersions]);

  const getInitialAdjustmentValues = useCallback((format: ResizeFormat) => {
    if (format.customOffset && format.customScale) {
      return { offset: format.customOffset, scale: format.customScale };
    }

    // Calculate default values based on standard crop logic
    if (!masterImage || masterDimensions.width === 0) return { offset: { x: 0, y: 0 }, scale: 1 };

    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;
    const focusPoint = {
      x: selectionArea.x + selectionArea.width / 2,
      y: selectionArea.y + selectionArea.height / 2
    };

    let scale = 1;
    let offset = { x: 0, y: 0 };

    if (imgRatio > targetRatio) {
      // Image is wider than target
      const sourceWidth = imgHeight * targetRatio;
      scale = imgWidth / sourceWidth;
      
      let targetFocusX = focusPoint.x;
      if (focusPoint.x === 0.5 && format.focus === 'left') targetFocusX = 0;
      
      const sourceX = Math.max(0, Math.min(imgWidth - sourceWidth, (imgWidth * targetFocusX) - (sourceWidth / 2)));
      offset.x = (sourceX / imgWidth) * scale;
      offset.y = 0;
    } else {
      // Image is taller than target
      const sourceHeight = imgWidth / targetRatio;
      scale = 1; // Because width matches container width (scale 1 in our modal definition)
      
      let targetFocusY = focusPoint.y;
      let sourceY = 0;
      if (format.id === 'standard') {
        sourceY = (imgHeight * targetFocusY) - (sourceHeight * (1/6));
      } else {
        sourceY = (imgHeight * targetFocusY) - (sourceHeight / 2);
      }
      sourceY = Math.max(0, Math.min(imgHeight - sourceHeight, sourceY));
      
      offset.x = 0;
      offset.y = (sourceY / sourceHeight);
    }

    return { offset, scale };
  }, [masterImage, masterDimensions, selectionArea, formats]);

  const handleZoom = useCallback((formatId: string, delta: number) => {
    const format = formats.find(f => f.id === formatId);
    if (!format) return;

    const currentValues = getInitialAdjustmentValues(format);
    
    // Calculate minimum scale to prevent white areas
    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;
    const minScale = imgRatio > targetRatio ? imgRatio / targetRatio : 1;

    const newScale = Math.max(minScale, Math.min(10, currentValues.scale + delta));
    
    // Clamp offsets
    const maxOffsetX = Math.max(0, newScale - 1);
    const maxOffsetY = Math.max(0, (newScale * targetRatio / imgRatio) - 1);
    
    const newOffset = {
      x: Math.max(0, Math.min(maxOffsetX, currentValues.offset.x)),
      y: Math.max(0, Math.min(maxOffsetY, currentValues.offset.y))
    };

    const newFormats = formats.map(f => 
      f.id === formatId ? { ...f, customOffset: newOffset, customScale: newScale } : f
    );
    setFormats(newFormats);
    
    if (masterImage) {
      generateResizedVersions(masterImage, selectionArea, newFormats);
    }
  }, [formats, getInitialAdjustmentValues, masterDimensions, masterImage, selectionArea, generateResizedVersions]);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent, formatId: string) => {
    e.stopPropagation();
    setDraggingFormatId(formatId);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });
    setDraggedRect(e.currentTarget.getBoundingClientRect());
  }, []);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingFormatId || !masterImage || !draggedRect) return;

    // Throttle updates to ~60fps
    const now = Date.now();
    if (now - lastUpdateRef.current < 16) return;
    lastUpdateRef.current = now;

    const format = formats.find(f => f.id === draggingFormatId);
    if (!format) return;

    const currentValues = getInitialAdjustmentValues(format);
    
    // Use the stored rect of the specific preview container
    const dx = (e.clientX - previewDragStart.x) / draggedRect.width;
    const dy = (e.clientY - previewDragStart.y) / draggedRect.height;

    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;

    let newOffsetX = currentValues.offset.x - dx;
    let newOffsetY = currentValues.offset.y - dy;

    // Clamp offsets
    const maxOffsetX = Math.max(0, currentValues.scale - 1);
    const maxOffsetY = Math.max(0, (currentValues.scale * targetRatio / imgRatio) - 1);

    const newOffset = { 
      x: Math.max(0, Math.min(maxOffsetX, newOffsetX)), 
      y: Math.max(0, Math.min(maxOffsetY, newOffsetY)) 
    };

    const newFormats = formats.map(f => 
      f.id === draggingFormatId ? { ...f, customOffset: newOffset, customScale: currentValues.scale } : f
    );
    
    setFormats(newFormats);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });

    // Only update the specific format being dragged for maximum fluidity
    generateResizedVersions(masterImage, selectionArea, newFormats, draggingFormatId);
  }, [draggingFormatId, masterImage, draggedRect, formats, getInitialAdjustmentValues, previewDragStart, masterDimensions, selectionArea, generateResizedVersions]);

  const handlePreviewMouseUp = useCallback(() => {
    setDraggingFormatId(null);
    setDraggedRect(null);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!masterContainerRef.current || !masterImage) return;
    
    const rect = masterContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setSelectionArea({ x, y, width: 0, height: 0 });
  }, [masterImage]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !masterContainerRef.current) return;
    
    const rect = masterContainerRef.current.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / rect.width;
    const currentY = (e.clientY - rect.top) / rect.height;
    
    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);
    
    setSelectionArea({ 
      x: Math.max(0, x), 
      y: Math.max(0, y), 
      width: Math.min(1 - x, width), 
      height: Math.min(1 - y, height) 
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (masterImage) {
        generateResizedVersions(masterImage, selectionArea);
      }
    }
  }, [isDragging, masterImage, selectionArea, generateResizedVersions]);

  const getCropRect = useCallback((format: ResizeFormat) => {
    if (!imageRef.current) return null;
    
    const imgW = imageRef.current.naturalWidth;
    const imgH = imageRef.current.naturalHeight;
    const targetRatio = format.width / format.height;
    const imgRatio = imgW / imgH;

    let w, h, x, y;

    const focusPoint = {
      x: selectionArea.x + selectionArea.width / 2,
      y: selectionArea.y + selectionArea.height / 2
    };

    if (imgRatio > targetRatio) {
      h = 100;
      w = (imgH * targetRatio / imgW) * 100;
      
      let targetFocusX = focusPoint.x;
      if (focusPoint.x === 0.5 && format.focus === 'left') targetFocusX = 0;
      
      x = (targetFocusX * 100) - (w / 2);
      x = Math.max(0, Math.min(100 - w, x));
      y = 0;
    } else {
      w = 100;
      h = (imgW / targetRatio / imgH) * 100;
      x = 0;
      y = (focusPoint.y * 100) - (h / 2);
      y = Math.max(0, Math.min(100 - h, y));
    }

    return { top: `${y}%`, left: `${x}%`, width: `${w}%`, height: `${h}%` };
  }, [selectionArea]);

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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  }, [processFile]);

  return (
    <div className="min-h-screen flex flex-col bg-bento-bg">
      {/* Header */}
      <header className="h-16 px-6 flex items-center border-b border-bento-border bg-bento-card relative">
        <div className="flex items-center gap-3 cursor-pointer select-none" onClick={handleLogoClick}>
          <div className="w-6 h-6 bg-bento-accent rounded-md flex items-center justify-center shadow-lg shadow-bento-accent/20">
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-2xl aspect-video bento-card border-dashed border-2 border-bento-border hover:border-bento-accent transition-all cursor-pointer flex flex-col items-center justify-center group"
            >
              <div className="w-16 h-16 bg-bento-accent/10 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                <Upload className="w-6 h-6 text-bento-accent" />
              </div>
              <h2 className="text-xl font-bold mb-2">Drop your Master image</h2>
              <p className="text-bento-dim text-sm text-center max-w-xs">
                High resolution format recommended for optimal variations.
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="bento-grid-container">
            {/* Master View Section */}
            <section className="bento-card" style={{ gridArea: '1 / 1 / 11 / 8' }}>
              <div className="bento-card-header flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-bento-dim font-bold">Visual Name :</span>
                  <input 
                    type="text" 
                    value={customBaseName}
                    onChange={(e) => setCustomBaseName(e.target.value)}
                    className="bg-transparent border-b border-bento-border focus:border-bento-accent outline-none text-xs font-bold py-0.5 px-1 min-w-[200px]"
                    placeholder="Enter image name..."
                  />
                </div>
                <span className="bento-badge">Draw a square to define the important area</span>
              </div>
              <div 
                ref={masterContainerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="flex-1 bg-black relative flex items-center justify-center overflow-hidden cursor-crosshair group select-none"
              >
                <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
                  <img 
                    ref={imageRef}
                    src={masterImage} 
                    alt="Master" 
                    className="w-full h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity" 
                    referrerPolicy="no-referrer" 
                  />
                  
                  {/* Crop Overlay */}
                  <AnimatePresence>
                    {hoveredFormat && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute pointer-events-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] z-10"
                        style={getCropRect(hoveredFormat) || {}}
                      >
                        <div className="absolute top-2 left-2 bg-white text-black text-[8px] font-bold px-1 rounded uppercase">
                          {hoveredFormat.name}
                        </div>
                        
                        {/* Master View Overlay */}
                        {hoveredFormat.overlay && (
                          <div 
                            className="absolute pointer-events-none"
                            style={hoveredFormat.overlay.style}
                          />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Selection Area Visualizer */}
                <motion.div 
                  initial={false}
                  animate={{ 
                    left: `${selectionArea.x * 100}%`, 
                    top: `${selectionArea.y * 100}%`,
                    width: `${selectionArea.width * 100}%`,
                    height: `${selectionArea.height * 100}%`
                  }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="absolute border-2 border-bento-accent bg-bento-accent/10 pointer-events-none z-20 shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                >
                  <div className="absolute -top-1 -left-1 w-2 h-2 bg-bento-accent rounded-full" />
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-bento-accent rounded-full" />
                  <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-bento-accent rounded-full" />
                  <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-bento-accent rounded-full" />
                </motion.div>
                
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <p className="text-[10px] font-mono text-white/80">
                    Zone: {Math.round(selectionArea.width * 100)}% x {Math.round(selectionArea.height * 100)}%
                  </p>
                </div>
              </div>
            </section>

            {/* Formats Listing Section */}
            <section className="bento-card" style={{ gridArea: '1 / 8 / 11 / 13' }}>
              <div className="bento-card-header">
                <span className="bento-card-title">Web Variations</span>
              </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-bento-border"
                     onMouseMove={handlePreviewMouseMove}
                     onMouseUp={handlePreviewMouseUp}
                     onMouseLeave={handlePreviewMouseUp}>
                {formats.map((format) => (
                  <div 
                    key={format.id} 
                    onMouseEnter={() => setHoveredFormat(format)}
                    onMouseLeave={() => setHoveredFormat(null)}
                    className="bg-bento-bg border border-bento-border rounded-lg p-3 flex flex-col gap-3 group hover:border-bento-accent/50 transition-colors cursor-default"
                  >
                    <div 
                      onMouseDown={(e) => handlePreviewMouseDown(e, format.id)}
                      className={`w-full bg-black/40 rounded border border-bento-border overflow-hidden flex items-center justify-center shrink-0 relative transition-colors group/preview ${draggingFormatId === format.id ? 'cursor-grabbing border-bento-accent' : 'cursor-grab hover:border-bento-accent'}`}
                      style={{ 
                        aspectRatio: `${format.width} / ${format.height}`,
                        maxWidth: format.id === 'square' ? '180px' : 'none',
                        margin: format.id === 'square' ? '0 auto' : '0'
                      }}
                    >
                      {resizedImages[format.id] ? (
                        <img src={resizedImages[format.id]} alt={format.name} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <div className="w-full h-2 bg-bento-accent/20" />
                      )}
                      
                      {/* Format Overlay */}
                      {format.overlay && (
                        <div 
                          className="absolute pointer-events-none z-10"
                          style={format.overlay.style}
                        />
                      )}

                      <div className="absolute inset-0 bg-bento-accent/20 opacity-0 group-hover/preview:opacity-100 flex items-center justify-center transition-opacity pointer-events-none z-20">
                        <Move className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">{format.name}</div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-bento-dim">{format.width}x{format.height}</span>
                          <div className="text-[8px] px-2 py-1 rounded-full border border-bento-border text-bento-dim font-bold">
                            Crop
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMirror(format.id);
                            }}
                            className={`p-1.5 rounded-md border transition-all ${
                              format.mirror 
                                ? 'bg-bento-accent/20 border-bento-accent text-bento-accent' 
                                : 'border-bento-border text-bento-dim hover:border-bento-accent'
                            }`}
                            title="Horizontal Mirror Effect"
                          >
                            <FlipHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-1 bg-bento-card border border-bento-border rounded-md p-1">
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleZoom(format.id, -0.1); }}
                            className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded text-bento-dim hover:text-white transition-colors text-sm font-bold"
                          >
                            -
                          </button>
                          <span className="text-[10px] font-mono w-8 text-center text-bento-dim">
                            {Math.round((format.customScale || getInitialAdjustmentValues(format).scale) * 100)}%
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleZoom(format.id, 0.1); }}
                            className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded text-bento-dim hover:text-white transition-colors text-sm font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                    <a 
                      href={resizedImages[format.id]} 
                      download={`${format.width}x${format.height}_${(customBaseName || (originalFile ? originalFile.name.split('.')[0] : 'image')).replace(/\s+/g, '')}${format.focus === 'left' ? '_left' : ''}.jpg`}
                      onClick={() => trackEvent('export', 1)}
                      className="p-1.5 rounded-md hover:bg-bento-accent/10 text-bento-dim hover:text-bento-accent transition-all opacity-0 group-hover:opacity-100 flex items-center gap-2 text-[10px] font-bold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-bento-border">
                <button 
                  onClick={downloadAll}
                  className="bento-btn-outline w-full flex items-center justify-center gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export All
                </button>
              </div>
            </section>

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
                    className="p-1 hover:bg-white/10 rounded-md transition-colors group"
                    title="Force Refresh"
                  >
                    <RefreshCw className="w-4 h-4 text-bento-dim group-active:rotate-180 transition-transform duration-500" />
                  </button>
                  <button 
                    onClick={() => setIsAdminOpen(false)}
                    className="p-2 hover:bg-white/10 rounded-md transition-colors text-bento-dim hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-bento-bg p-4 rounded-xl border border-bento-border text-center">
                  <div className="text-2xl font-bold text-bento-accent">
                    {adminStats?.total_exports || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-bento-dim font-bold mt-1">
                    Total Exports
                  </div>
                </div>
                <div className="bg-bento-bg p-4 rounded-xl border border-bento-border text-center">
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

      {masterImage && draggingFormatId && (
        <div className="fixed inset-0 z-50 pointer-events-none" />
      )}
    </div>
  );
}
