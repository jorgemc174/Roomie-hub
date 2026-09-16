import sharp from 'sharp';
export async function sanitizeRatingPhoto(bytes:Uint8Array,mime:string){
 if(bytes.length>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('invalid_photo');
 const image=sharp(bytes,{limitInputPixels:20_000_000,failOn:'warning'});
 const meta=await image.metadata();
 if(!meta.format||({'jpeg':'image/jpeg','png':'image/png','webp':'image/webp'} as Record<string,string>)[meta.format]!==mime||(meta.pages??1)>1)throw new Error('invalid_photo');
 // Sharp re-encodes without EXIF/XMP/IPTC unless explicitly asked to retain metadata.
 const data=await image.autoOrient().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
 if(data.length>5*1024*1024)throw new Error('invalid_photo');return data;
}
