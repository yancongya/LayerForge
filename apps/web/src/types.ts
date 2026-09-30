export type Layer = {
  id: string;
  name: string;
  file: string;
  order: number;
  groupId?: string | null;
  url: string;
  /** Canvas layout only — compose ignores it (see docs/canvas-audit.md 硬约定 1). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Natural PNG size; drives the card aspect so non-3:4 sources are not stretched. */
  imgW?: number;
  imgH?: number;
  visible?: boolean;
  locked?: boolean;
};

export type LayerGroup = {
  id: string;
  name: string;
  order: number;
  memberIds: string[];
  collapsed?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  imgW?: number;
  imgH?: number;
  /** groups/<id>.png after compose (P1-A). */
  previewUrl?: string | null;
};

export type ProjectPayload = {
  id: string;
  /** Monotonic revision of layers.json; the only signal that another writer moved. */
  rev: number;
  root: string;
  layers: Layer[];
  groups: LayerGroup[];
  sourceUrl: string | null;
  compositeUrl: string | null;
  output?: string;
  provider?: string;
  source?: string;
};

export type ExportResult = {
  out_dir: string;
  files: string[];
};

export type ViewMode = "canvas" | "groups";
