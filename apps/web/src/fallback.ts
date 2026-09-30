import type { ProjectPayload } from "./types";

export const FALLBACK_PROJECT: ProjectPayload = {
  id: "demo",
  rev: 0,
  root: "projects/demo",
  layers: [
    {
      id: "base",
      name: "Base",
      file: "assets/demo/base.png",
      order: 0,
      groupId: null,
      url: "./assets/demo/base.png",
    },
    {
      id: "mid",
      name: "Wash",
      file: "assets/demo/mid.png",
      order: 1,
      groupId: null,
      url: "./assets/demo/mid.png",
    },
    {
      id: "fg",
      name: "Highlights",
      file: "assets/demo/fg.png",
      order: 2,
      groupId: null,
      url: "./assets/demo/fg.png",
    },
  ],
  groups: [],
  sourceUrl: "./assets/demo/source.png",
  compositeUrl: "./assets/demo/composite.png",
};
