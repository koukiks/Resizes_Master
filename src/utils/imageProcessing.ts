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

    if (format.mirror) {
      ctx.translate(format.width, 0);
      ctx.scale(-1, 1);
    }

    const imgWidth = image.width;
    const imgHeight = image.height;
    const targetRatio = format.width / format.height;
    const imgRatio = imgWidth / imgHeight;

    const focusPoint = {
      x: selectionArea.x + selectionArea.width / 2,
      y: selectionArea.y + selectionArea.height / 2
    };

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = imgWidth;
    let sourceHeight = imgHeight;

    if (format.customOffset && format.customScale !== undefined && format.customScale > 0) {
      sourceWidth = imgWidth / format.customScale;
      sourceHeight = sourceWidth / targetRatio;
      sourceX = (format.customOffset.x / format.customScale) * imgWidth;
      
      if (format.mirror) {
        sourceX = imgWidth - sourceWidth - sourceX;
      }
      sourceY = (format.customOffset.y / format.customScale) * (imgWidth / targetRatio);
    } else {
      if (imgRatio > targetRatio) {
        sourceWidth = imgHeight * targetRatio;
        let targetFocusX = focusPoint.x;
        if (focusPoint.x === 0.5 && format.focus === 'left') targetFocusX = 0;
        sourceX = (imgWidth * targetFocusX) - (sourceWidth / 2);
        sourceX = Math.max(0, Math.min(imgWidth - sourceWidth, sourceX));
      } else {
        sourceHeight = imgWidth / targetRatio;
        let targetFocusY = focusPoint.y;
        if (format.id === 'standard') {
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
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, format.width, format.height
    );

    resolve(canvas.toDataURL('image/jpeg', 0.9));
  });
};
