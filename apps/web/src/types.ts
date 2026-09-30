export type Layer = {
  id: string;
  name: string;
  file: string;
  order: number;
  groupId?: string | null;
  url: string;
};

export type LayerGroup = {
  id: string;
  name: string;
  order: number;
  memberIds: string[];
  collapsed?: boolean;
};

export type ProjectPayload = {
  id: string;
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
