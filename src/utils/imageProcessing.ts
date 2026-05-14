import { ResizeFormat, SelectionArea } from '../types';

export const resizeImage = (
  image: HTMLImageElement,
  format: ResizeFormat,
  selectionArea: SelectionArea = { x: 0.5, y: 0.5, width: 0, height: 0 }
): Promise<string> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      resolve('');
      return;
    }

    canvas.width = format.width;
    canvas.height = format.height;

    const imgWidth = image.width;
    const imgHeight = image.height;
    const targetRatio = format.width / format.height;
    const imgRatio = imgWidth / imgHeight;

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = imgWidth;
    let sourceHeight = imgHeight;

    if (format.customOffset && format.customScale !== undefined && format.customScale > 0) {
      // Manual mode - priorities user's manual adjustments per format
      const sw1 = imgRatio > targetRatio ? (imgHeight * targetRatio) : imgWidth;
      const sh1 = imgRatio > targetRatio ? imgHeight : (imgWidth / targetRatio);
      
      sourceWidth = sw1 / format.customScale;
      sourceHeight = sh1 / format.customScale;
      sourceX = (format.customOffset.x / format.customScale) * sw1;
      
      if (format.mirror) {
        sourceX = imgWidth - sourceWidth - sourceX;
      }
      sourceY = (format.customOffset.y / format.customScale) * sh1;
    } else {
      // Simple centering logic
      if (imgRatio > targetRatio) {
        sourceWidth = imgHeight * targetRatio;
        sourceHeight = imgHeight;
        sourceX = (imgWidth - sourceWidth) / 2;
        sourceY = 0;
      } else {
        sourceWidth = imgWidth;
        sourceHeight = imgWidth / targetRatio;
        sourceX = 0;
        sourceY = (imgHeight - sourceHeight) / 2;
      }

      // Small vertical nudge for portrait images to keep heads in frame (top-weighted)
      if (imgRatio < 1 && targetRatio < 1) {
        sourceY = Math.max(0, sourceY - (sourceHeight * 0.1));
      }
    }

    // Secondary adjustments for specific formats
    if (format.id === 'standard' && !format.customOffset) {
      sourceY = Math.max(0, sourceY - (sourceHeight * 0.05));
    }

    // Safety bounds
    sourceX = Math.max(0, Math.min(imgWidth - sourceWidth, sourceX));
    sourceY = Math.max(0, Math.min(imgHeight - sourceHeight, sourceY));

    if (format.mirror) {
      ctx.translate(format.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(
      image,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, format.width, format.height
    );

    resolve(canvas.toDataURL('image/jpeg', 0.9));
  });
};
