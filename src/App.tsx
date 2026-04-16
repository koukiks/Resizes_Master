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
  Move
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RESIZE_FORMATS, ResizeFormat, SelectionArea } from './types';
import { resizeImage } from './utils/imageProcessing';

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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setOriginalFile(file);
    setCustomBaseName(file.name.split('.')[0]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setMasterImage(result);
      
      const img = new Image();
      img.onload = () => {
        setMasterDimensions({ width: img.width, height: img.height });
        const initialSelection = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
        setSelectionArea(initialSelection);
        generateResizedVersions(result, initialSelection, formats);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const generateResizedVersions = async (imageSrc: string, area = selectionArea, currentFormats = formats, singleFormatId?: string) => {
    if (!singleFormatId) setIsProcessing(true);
    
    const img = new Image();
    img.src = imageSrc;
    
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const results: Record<string, string> = { ...resizedImages };
    const formatsToProcess = singleFormatId 
      ? currentFormats.filter(f => f.id === singleFormatId)
      : currentFormats;

    for (const format of formatsToProcess) {
      const resized = await resizeImage(img, format, area);
      results[format.id] = resized;
    }
    
    setResizedImages(results);
    if (!singleFormatId) setIsProcessing(false);
  };

  const toggleMirror = (formatId: string) => {
    const newFormats = formats.map(f => 
      f.id === formatId ? { ...f, mirror: !f.mirror } : f
    );
    setFormats(newFormats);
    
    if (masterImage) {
      generateResizedVersions(masterImage, selectionArea, newFormats);
    }
  };

  const handleZoom = (formatId: string, delta: number) => {
    const format = formats.find(f => f.id === formatId);
    if (!format) return;

    const currentValues = getInitialAdjustmentValues(format);
    
    // Calculate minimum scale to prevent white areas
    const imgWidth = masterDimensions.width;
    const imgHeight = masterDimensions.height;
    const imgRatio = imgWidth / imgHeight;
    const targetRatio = format.width / format.height;
    const minScale = imgRatio > targetRatio ? imgRatio / targetRatio : 1;

    const newScale = Math.max(minScale, Math.min(5, currentValues.scale + delta));
    
    // Re-clamp offset with new scale
    const maxOffsetX = Math.max(0, newScale - 1);
    const maxOffsetY = Math.max(0, (targetRatio / imgRatio) * newScale - 1);
    
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
  };

  const handlePreviewMouseDown = (e: React.MouseEvent, formatId: string) => {
    e.stopPropagation();
    setDraggingFormatId(formatId);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });
    setDraggedRect(e.currentTarget.getBoundingClientRect());
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
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

    const maxOffsetX = Math.max(0, currentValues.scale - 1);
    const maxOffsetY = Math.max(0, (targetRatio / imgRatio) * currentValues.scale - 1);

    newOffsetX = Math.max(0, Math.min(maxOffsetX, newOffsetX));
    newOffsetY = Math.max(0, Math.min(maxOffsetY, newOffsetY));

    const newOffset = { x: newOffsetX, y: newOffsetY };

    const newFormats = formats.map(f => 
      f.id === draggingFormatId ? { ...f, customOffset: newOffset, customScale: currentValues.scale } : f
    );
    
    setFormats(newFormats);
    setPreviewDragStart({ x: e.clientX, y: e.clientY });

    // Only update the specific format being dragged for maximum fluidity
    generateResizedVersions(masterImage, selectionArea, newFormats, draggingFormatId);
  };

  const handlePreviewMouseUp = () => {
    setDraggingFormatId(null);
    setDraggedRect(null);
  };

  const getInitialAdjustmentValues = (format: ResizeFormat) => {
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
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!masterContainerRef.current || !masterImage) return;
    
    const rect = masterContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setSelectionArea({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
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
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      if (masterImage) {
        generateResizedVersions(masterImage, selectionArea);
      }
    }
  };

  const getCropRect = (format: ResizeFormat) => {
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
  };

  const downloadAll = async () => {
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
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-bento-bg">
      {/* Header */}
      <header className="h-16 px-6 flex items-center justify-between border-b border-bento-border bg-bento-card">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-bento-accent rounded-md flex items-center justify-center shadow-lg shadow-bento-accent/20">
            <Layers className="text-white w-4 h-4" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Master Resizer <span className="font-light opacity-50">v2.4.0</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-[10px] uppercase tracking-widest text-bento-dim font-bold">Status: {masterImage ? 'Ready' : 'Waiting'}</span>
          {masterImage && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bento-btn-outline flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Change
            </button>
          )}
          <button 
            onClick={masterImage ? downloadAll : () => fileInputRef.current?.click()}
            className="bento-btn flex items-center gap-2"
          >
            {masterImage ? (
              <>
                <Download className="w-3.5 h-3.5" />
                Export All
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Import Master
              </>
            )}
          </button>
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
                  <span className="text-[10px] uppercase tracking-widest text-bento-dim font-bold">Source :</span>
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
                      style={{ aspectRatio: `${format.width} / ${format.height}` }}
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
