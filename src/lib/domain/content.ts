export interface Feature {
  label_es: string | null;
  label_en: string | null;
  value_es: string | null;
  value_en: string | null;
}
export interface TourNode {
  mediaId: number;
  name_es: string | null;
  name_en: string | null;
  initialView: { yaw: number | null; pitch: number | null; fov: number | null } | null;
  links: { toMediaId: number; yaw: number; pitch: number }[];
}
export interface Tour {
  startMediaId: number;
  nodes: TourNode[];
}
export interface SocialLink {
  platform: string;
  url: string;
}
