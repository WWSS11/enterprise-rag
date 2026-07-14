import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  focusable: "false" as const,
};

export function IconChat(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3.5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7l-2.5 2v-2H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3.5h3v9H3zM7 3.5h3v9H7zM11 4.5l2 1v7l-2 1z" />
    </svg>
  );
}

export function IconDocument(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 2.5h5l2.5 2.5v8.5a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
      <path d="M9.5 2.5V5H12" />
    </svg>
  );
}

export function IconEval(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12.5V8M6.5 12.5V5M10 12.5V7M13 12.5V3.5" />
    </svg>
  );
}

export function IconJobs(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.5h10M4 5.5V12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V5.5M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    </svg>
  );
}

export function IconSystem(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5.5" y="5.5" width="7" height="7" rx="1" />
      <path d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}
