declare module 'd3-force-3d' {
  type Accessor<T> = number | ((value: T, index?: number) => number);
  type Force<T> = {
    strength(value: Accessor<T>): Force<T>;
  };

  export function forceCollide<T = any>(radius?: Accessor<T>): Force<T>;
  export function forceRadial<T = any>(radius: Accessor<T>, x?: number, y?: number, z?: number): Force<T>;
  export function forceY<T = any>(y?: Accessor<T>): Force<T>;
}
