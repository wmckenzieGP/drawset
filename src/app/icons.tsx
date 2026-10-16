/** Original line icons for Drawset (24×24 grid, stroke-based). */
import type { ReactElement } from "react";

const P: Record<string, ReactElement> = {
  select: <path d="M6 3l12 9-5.5 1.2L15 20l-2.6 1.1-2.6-6.5L6 18z" />,
  pan: <path d="M8 13V6.5a1.5 1.5 0 013 0V12m0-6.5V4.5a1.5 1.5 0 013 0V12m0-6a1.5 1.5 0 013 0v7m0-4a1.5 1.5 0 013 0v5c0 4-2.5 7-6.5 7-3 0-4.5-1.4-6.3-4l-2.5-3.8a1.5 1.5 0 012.4-1.8L8 15" />,
  text: <path d="M5 5h14M12 5v14M9 19h6" />,
  zoom: <path d="M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20M8 10.5h5M10.5 8v5" />,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="0.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6" />,
  line: <path d="M4 19L20 5" />,
  arrow: <path d="M4 20L19 5M11 5h8v8" />,
  polyline: <path d="M3 18l5-9 5 6 4-9 4 4" />,
  polygon: <path d="M12 3.5l8 6-3 9.5H7L4 9.5z" />,
  cloud: <path d="M6 16a3 3 0 010-6 3 3 0 013-3.5 3 3 0 015.5-.5 3 3 0 014.5 3 3 3 0 010 6 3 3 0 01-4.5 1.5 3 3 0 01-4.5 0A3 3 0 016 16z" />,
  pen: <path d="M4 20l1.5-5L16 4.5l3.5 3.5L9 18.5zM14 6.5l3.5 3.5" />,
  highlighter: <path d="M4 20h6M7 17l-2-2 9-9 4 4-9 9zM14 6l2-2 4 4-2 2" />,
  textbox: <path d="M4 5h16v14H4zM8 9h8M12 9v7" />,
  callout: <path d="M9 5h11v9h-8l-5 6 1-6H9z" />,
  note: <path d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 12h5" />,
  highlight: <path d="M4 15h16v4H4zM8 6h8M12 6v6" />,
  underline: <path d="M7 4v6a5 5 0 0010 0V4M5 20h14" />,
  strikeout: <path d="M4 12h16M16 6.5C15 5 13.6 4.5 12 4.5 9.5 4.5 8 6 8 7.5c0 4 8 3 8 8 0 2-1.8 3.5-4.2 3.5-2 0-3.5-.8-4.3-2.3" />,
  stamp: <path d="M9 4h6l-1 7h4l1 4H5l1-4h4zM5 19h14" />,
  image: <path d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h2" />,
  open: <path d="M3 7h6l2 2h10v10H3zM3 7V5h6l2 2" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  print: <path d="M7 9V4h10v5M7 17H4V9h16v8h-3M7 14h10v6H7z" />,
  fitPage: <path d="M7 3H3v4M17 3h4v4M7 21H3v-4M17 21h4v-4M8 7h8v10H8z" />,
  fitWidth: <path d="M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" />,
  rotate: <path d="M20 11a8 8 0 10-2.4 5.7M20 4v7h-7" />,
  reuse: <path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5zM12 15v2" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: <path d="M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20" />,
  pages: <path d="M7 3h8l4 4v12H7zM5 7v14h11" />,
  bookmark: <path d="M7 3h10v18l-5-4-5 4z" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  props: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? P.select}
    </svg>
  );
}
