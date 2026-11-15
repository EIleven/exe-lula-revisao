
// src/lib/utils/imageUtils.ts
import { type Area } from 'react-easy-crop';

export const getCroppedImg = (imageSrc: string, pixelCrop: Area): Promise<Blob | null> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );

      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.95);
    });
    
    image.addEventListener('error', (error) => reject(error));
    
    // Set crossOrigin to anonymous to avoid CORS issues if imageSrc is a URL from another domain
    image.crossOrigin = "anonymous"; 
    image.src = imageSrc;
  });
};
