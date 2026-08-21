interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Icons are drawn rather than imported: an icon font or SVG sprite would be the
 * only asset dependency in the project, for eleven glyphs.
 */
function svg(size: number, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MotionIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M3.5 6v4" />
      <path d="M6.5 3.5v9" />
      <path d="M9.5 5v6" />
      <path d="M12.5 7v2" />
    </>
  ));

export const PlayIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, <path d="M5 3.6l7 4.4-7 4.4z" fill="currentColor" strokeWidth="1" />);

export const CloseIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ));

export const CheckIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, <path d="M3.5 8.5l3 3 6-7" />);

export const ChevronIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, <path d="M6 3.5l4.5 4.5L6 12.5" />);

export const BackIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </>
  ));

export const AlertIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <path d="M8 10.8v.2" />
    </>
  ));

export const UploadIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M8 10.5V3" />
      <path d="M5 5.8L8 2.8l3 3" />
      <path d="M3 10.5v1.8A1.2 1.2 0 004.2 13.5h7.6A1.2 1.2 0 0013 12.3v-1.8" />
    </>
  ));

export const SearchIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </>
  ));

export const SpinnerIcon = ({ size = 14, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    className={`animate-spin ${className ?? ''}`}
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
    <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const FilmIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.4" />
      <path d="M5 3.5v9" />
      <path d="M11 3.5v9" />
      <path d="M2 8h12" />
    </>
  ));

export const TrashIcon = ({ size = 14, className }: IconProps) =>
  svg(size, className, (
    <>
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3.2h3v1.3" />
      <path d="M4.3 4.5l.5 8h6.4l.5-8" />
    </>
  ));
