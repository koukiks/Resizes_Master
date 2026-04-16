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

    if (format.mode === 'fill') {
      // 1. Draw blurred background (Cover)
      ctx.save();
      // Draw background scaled to cover the whole canvas
      const bgScale = Math.max(format.width / imgWidth, format.height / imgHeight);
      const bgW = imgWidth * bgScale;
      const bgH = imgHeight * bgScale;
      const bgX = (format.width - bgW) / 2;
      const bgY = (format.height - bgH) / 2;
      
      ctx.filter = 'blur(30px) brightness(0.6) saturate(1.2)';
      ctx.drawImage(image, bgX - 50, bgY - 50, bgW + 100, bgH + 100);
      ctx.restore();

      // 2. Draw main image (Contain)
      const scale = Math.min(format.width / imgWidth, format.height / imgHeight);
      const drawW = imgWidth * scale;
      const drawH = imgHeight * scale;
      const drawX = (format.width - drawW) / 2;
      const drawY = (format.height - drawH) / 2;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, drawX, drawY, drawW, drawH);
    } else {
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
    }

    resolve(canvas.toDataURL('image/jpeg', 0.9));
  });
};

export const generatePythonScript = (originalFileName: string): string => {
  return `import os
from PIL import Image

def resize_master(input_path, output_folder="outputs"):
    """
    Redimensionne une image Master en plusieurs formats web spécifiques.
    Utilise la méthode 'Crop and Fill' pour éviter les déformations.
    """
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    # Définition des formats
    formats = [
        {"name": "1920x480_Banniere", "size": (1920, 480), "focus": "center"},
        {"name": "1600x707_Focus_Centre", "size": (1600, 707), "focus": "center"},
        {"name": "1600x707_Focus_Gauche", "size": (1600, 707), "focus": "left"},
        {"name": "400x400_Carre", "size": (400, 400), "focus": "center"},
        {"name": "620x436_Standard", "size": (620, 436), "focus": "center"},
    ]

    try:
        img = Image.open(input_path)
        img_w, img_h = img.size
        
        for fmt in formats:
            target_w, target_h = fmt["size"]
            target_ratio = target_w / target_h
            img_ratio = img_w / img_h

            if img_ratio > target_ratio:
                # Image plus large que la cible
                new_w = int(img_h * target_ratio)
                new_h = img_h
                if fmt["focus"] == "center":
                    left = (img_w - new_w) // 2
                else: # focus left
                    left = 0
                top = 0
                right = left + new_w
                bottom = img_h
            else:
                # Image plus haute que la cible
                new_w = img_w
                new_h = int(img_w / target_ratio)
                left = 0
                top = (img_h - new_h) // 2
                right = img_w
                bottom = top + new_h

            # Crop and Resize
            cropped_img = img.crop((left, top, right, bottom))
            resized_img = cropped_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            
            output_name = f"{fmt['name']}.jpg"
            resized_img.save(os.path.join(output_folder, output_name), "JPEG", quality=90)
            print(f"Généré : {output_name}")

        print("\\nTraitement terminé avec succès !")
        
    except Exception as e:
        print(f"Erreur lors du traitement : {e}")

if __name__ == "__main__":
    # Remplacez par le chemin de votre image
    resize_master("${originalFileName}")
`;
};
