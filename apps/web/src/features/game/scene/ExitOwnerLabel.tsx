import { useEffect, useMemo } from 'react';
import { CanvasTexture } from 'three';

export type OwnerNames = Readonly<Record<string, string>>;
export function exitOwnerLabel(ownerId: string, selfId: string | undefined, names: OwnerNames) {
  return ownerId === selfId ? '내 출구' : `${names[ownerId] ?? '알 수 없는 참가자'}의 출구`;
}

export function ExitOwnerLabel({ text }: { text: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#161615';
      context.fillRect(0, 0, 512, 96);
      context.fillStyle = '#fafaf3';
      context.font = 'bold 36px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 256, 48, 490);
    }
    return new CanvasTexture(canvas);
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 0.31, 0.004]}>
      <planeGeometry args={[0.6, 0.12]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}
