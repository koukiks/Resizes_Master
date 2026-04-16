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

    // Fill background with white to avoid black images if transparency or empty areas occur
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, format.width, format.height);

    if (format.mirror) {
      ctx.translate(format.width, 0);
      ctx.scale(-1, 1);
    }

    const imgWidth = image.width;
    const imgHeight = image.height;
    const targetRatio = format.width / format.height;
    const imgRatio = imgWidth / imgHeight;

    // Calculate focus point from selection area (center of the selection)
    const focusPoint = {
      x: selectionArea.x + selectionArea.width / 2,
      y: selectionArea.y + selectionArea.height / 2
    };

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = imgWidth;
    let sourceHeight = imgHeight;

    if (format.customOffset && format.customScale !== undefined && format.customScale > 0) {
      // Manual Override
        // In the modal, scale is imageWidth / containerWidth
        // So sourceWidth = imgWidth / scale
        sourceWidth = imgWidth / format.customScale;
        sourceHeight = sourceWidth / targetRatio;
        
        // offset.x is fraction of container width the image is shifted left
        // sourceX = offset.x * containerWidth * (imgWidth / imageWidthInModal)
        // sourceX = offset.x * containerWidth * (imgWidth / (containerWidth * scale))
        // sourceX = (offset.x / scale) * imgWidth
        sourceX = (format.customOffset.x / format.customScale) * imgWidth;
        
        // If mirrored, the modal shows the image flipped, so offset.x 0 means 
        // we are looking at the right side of the original image.
        if (format.mirror) {
          sourceX = imgWidth - sourceWidth - sourceX;
        }

        sourceY = (format.customOffset.y / format.customScale) * (imgWidth / targetRatio);

        // Final safety clamp
        sourceX = Math.max(0, Math.min(imgWidth - sourceWidth, sourceX));
        sourceY = Math.max(0, Math.min(imgHeight - sourceHeight, sourceY));
      } else {
        // Standard Crop Logic
        if (imgRatio > targetRatio) {
          // Image is wider than target
          sourceWidth = imgHeight * targetRatio;
          
          // Use focusPoint.x if it's not the default center, otherwise respect format.focus
          let targetFocusX = focusPoint.x;
          if (focusPoint.x === 0.5 && format.focus === 'left') {
            targetFocusX = 0;
          }

          sourceX = (imgWidth * targetFocusX) - (sourceWidth / 2);
          sourceX = Math.max(0, Math.min(imgWidth - sourceWidth, sourceX));
        } else {
          // Image is taller than target
          sourceHeight = imgWidth / targetRatio;
          
          let targetFocusY = focusPoint.y;
          
          // Special constraint for 620x436 (standard): important element in top third
          if (format.id === 'standard') {
            // We want the focus point to be at 1/6th of the target height (center of top third)
            // So we shift the sourceY so that focusPoint.y is at 1/6th of sourceHeight
            sourceY = (imgHeight * targetFocusY) - (sourceHeight * (1/6));
          } else {
            sourceY = (imgHeight * targetFocusY) - (sourceHeight / 2);
          }
          
          sourceY = Math.max(0, Math.min(imgHeight - sourceHeight, sourceY));
        }
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        format.width,
        format.height
      );

    resolve(canvas.toDataURL('image/jpeg', 0.9));
  });
};
