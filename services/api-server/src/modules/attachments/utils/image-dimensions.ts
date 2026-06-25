export interface ImageDimensions {
  width: number;
  height: number;
}

export function parseImageDimensions(
  bytes: ArrayBuffer,
  mediaType: string,
): ImageDimensions | null {
  const view = new DataView(bytes);
  const normalizedMediaType = mediaType.toLowerCase().split(";")[0]?.trim();

  switch (normalizedMediaType) {
    case "image/png":
      return parsePngDimensions(view);
    case "image/jpeg":
    case "image/jpg":
      return parseJpegDimensions(view);
    case "image/gif":
      return parseGifDimensions(view);
    case "image/webp":
      return parseWebpDimensions(view);
    default:
      return null;
  }
}

function parsePngDimensions(view: DataView): ImageDimensions | null {
  if (
    view.byteLength < 24 ||
    view.getUint32(0) !== 0x89504E47 ||
    view.getUint32(4) !== 0x0D0A1A0A ||
    view.getUint32(12) !== 0x49484452
  ) {
    return null;
  }

  return validDimensions(view.getUint32(16), view.getUint32(20));
}

function parseGifDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 10) {
    return null;
  }

  const signature = asciiString(view, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }

  return validDimensions(view.getUint16(6, true), view.getUint16(8, true));
}

function parseJpegDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) !== 0xFF) {
      offset += 1;
    }
    while (offset < view.byteLength && view.getUint8(offset) === 0xFF) {
      offset += 1;
    }
    if (offset >= view.byteLength) {
      return null;
    }

    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === 0xD9 || marker === 0xDA) {
      return null;
    }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue;
    }
    if (offset + 2 > view.byteLength) {
      return null;
    }

    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
      return null;
    }

    if (isJpegStartOfFrameMarker(marker) && segmentLength >= 7) {
      return validDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }

    offset += segmentLength;
  }

  return null;
}

function parseWebpDimensions(view: DataView): ImageDimensions | null {
  if (
    view.byteLength < 20 ||
    asciiString(view, 0, 4) !== "RIFF" ||
    asciiString(view, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkType = asciiString(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > view.byteLength) {
      return null;
    }

    switch (chunkType) {
      case "VP8X":
        return parseVp8xDimensions(view, payloadOffset, chunkSize);
      case "VP8 ":
        return parseVp8Dimensions(view, payloadOffset, chunkSize);
      case "VP8L":
        return parseVp8lDimensions(view, payloadOffset, chunkSize);
      default:
        offset = payloadOffset + chunkSize + (chunkSize % 2);
    }
  }

  return null;
}

function parseVp8xDimensions(
  view: DataView,
  offset: number,
  chunkSize: number,
): ImageDimensions | null {
  if (chunkSize < 10) {
    return null;
  }

  const width = readUint24LittleEndian(view, offset + 4) + 1;
  const height = readUint24LittleEndian(view, offset + 7) + 1;
  return validDimensions(width, height);
}

function parseVp8Dimensions(
  view: DataView,
  offset: number,
  chunkSize: number,
): ImageDimensions | null {
  if (
    chunkSize < 10 ||
    view.getUint8(offset + 3) !== 0x9D ||
    view.getUint8(offset + 4) !== 0x01 ||
    view.getUint8(offset + 5) !== 0x2A
  ) {
    return null;
  }

  const width = view.getUint16(offset + 6, true) & 0x3FFF;
  const height = view.getUint16(offset + 8, true) & 0x3FFF;
  return validDimensions(width, height);
}

function parseVp8lDimensions(
  view: DataView,
  offset: number,
  chunkSize: number,
): ImageDimensions | null {
  if (chunkSize < 5 || view.getUint8(offset) !== 0x2F) {
    return null;
  }

  const bits = (
    view.getUint8(offset + 1) |
    (view.getUint8(offset + 2) << 8) |
    (view.getUint8(offset + 3) << 16) |
    (view.getUint8(offset + 4) << 24)
  ) >>> 0;
  const width = (bits & 0x3FFF) + 1;
  const height = ((bits >>> 14) & 0x3FFF) + 1;
  return validDimensions(width, height);
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xC0 && marker <= 0xC3) ||
    (marker >= 0xC5 && marker <= 0xC7) ||
    (marker >= 0xC9 && marker <= 0xCB) ||
    (marker >= 0xCD && marker <= 0xCF)
  );
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function readUint24LittleEndian(view: DataView, offset: number): number {
  return view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);
}

function asciiString(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) {
    return "";
  }

  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
