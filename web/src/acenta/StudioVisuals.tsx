/** Editorial SVG illustrations & crisp iconography for Acenta studio views. */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({
  size = 16,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ============================================================================
   Editorial Icons (1.8px stroke, warm rounded geometry)
   ============================================================================ */

export function UploadArrowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2" />
    </IconBase>
  );
}

export function CalendarPlanIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M8 2.5v3" />
      <path d="M16 2.5v3" />
      <path d="M3 9.5h18" />
      <path d="M8 14h3" />
      <path d="M14 14h2" />
      <path d="M8 17.5h6" />
    </IconBase>
  );
}

export function CompassNemIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.8 8.2 13.7 13.7 8.2 15.8 10.3 10.3 15.8 8.2" />
    </IconBase>
  );
}

export function ClipboardGuideIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </IconBase>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H10a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H4.5A2.5 2.5 0 0 0 2 20.5v-15Z" />
      <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H14a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h5.5a2.5 2.5 0 0 1 2.5 2.5v-15Z" />
    </IconBase>
  );
}

export function CameraBookIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5l-2-3Z" />
      <circle cx="12" cy="13" r="3.2" />
    </IconBase>
  );
}

export function ShieldLockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 5 6v6c0 4.6 3 7.8 7 9 4-1.2 7-4.4 7-9V6l-7-3Z" />
      <path d="m9.5 12.2 1.8 1.8 3.6-3.8" />
    </IconBase>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l1.7 4.7L18.5 9.5l-4.8 1.8L12 16l-1.7-4.7-4.8-1.8 4.8-1.8L12 3Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </IconBase>
  );
}

export function ScanDocIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7V5a2 2 0 0 1 2-2h2" />
      <path d="M20 7V5a2 2 0 0 0-2-2h-2" />
      <path d="M4 17v2a2 2 0 0 0 2 2h2" />
      <path d="M20 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 12h10" />
      <path d="M9 8.5h6" />
      <path d="M9 15.5h4" />
    </IconBase>
  );
}

export function FolderStackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4.2l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M7 13h10" />
    </IconBase>
  );
}

export function GlobeVerifiedIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9.5h17" />
      <path d="M3.5 14.5h17" />
      <path d="M12 3a13 13 0 0 1 3.5 9A13 13 0 0 1 12 21a13 13 0 0 1-3.5-9A13 13 0 0 1 12 3Z" />
    </IconBase>
  );
}

export function ChatTurnsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-4-.9L3 21l1.4-5.2A8.5 8.5 0 1 1 21 12Z" />
      <path d="M8.5 11.5h7" />
      <path d="M8.5 14.5h4.5" />
    </IconBase>
  );
}

export function WorksheetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 3H6.5A2 2 0 0 0 4.5 5v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h4.5" />
    </IconBase>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9V4h12v5" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <path d="M6 15h12v5H6z" />
      <circle cx="17" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function BudgetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.8 9.2c-.5-.8-1.5-1.2-2.8-1.2-1.7 0-2.8.8-2.8 2 0 2.5 5.6 1.2 5.6 4 0 1.2-1.2 2-2.9 2-1.4 0-2.4-.5-3-1.3" />
      <path d="M12 6.5v11" />
    </IconBase>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 17.5 5.2 8l4.3 3.8L12 6l2.5 5.8L18.8 8 21 17.5H3Z" />
      <path d="M4 20h16" />
    </IconBase>
  );
}

export function SchoolBuildingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 21h18" />
      <path d="M5 21V9.5L12 5l7 4.5V21" />
      <path d="M9.5 21v-5.5h5V21" />
      <path d="M12 10.5h.01" />
    </IconBase>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.7 12.2 2.2 2.2 4.4-4.6" />
    </IconBase>
  );
}

export function InfinityIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8Z" />
    </IconBase>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

/* ============================================================================
   Bespoke Editorial SVG Illustrations (Warm Paper + Clay + Sage + Ochre)
   ============================================================================ */

/**
 * Tactile 3-card stacked paper illustration for the hero Planeaciones dropzone.
 * Fans gently outward when the parent `.docs-dropzone` is hovered or dragged over.
 */
export function PlaneacionDropIllustration() {
  return (
    <div className="docs-hero-art" aria-hidden="true">
      <svg
        width="206"
        height="118"
        viewBox="0 0 206 118"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Soft sunlit desk shadow */}
        <ellipse cx="103" cy="106" rx="74" ry="8" fill="#1F6F54" fillOpacity="0.09" />

        {/* Left tilted sheet: Word / DOCX Dosificación */}
        <g className="docs-art-card-left">
          <rect
            x="24"
            y="24"
            width="64"
            height="78"
            rx="10"
            transform="rotate(-11 24 24)"
            fill="#FFFFFF"
            stroke="#CBD5E1"
            strokeWidth="1.5"
          />
          <rect
            x="33"
            y="34"
            width="24"
            height="8"
            rx="4"
            transform="rotate(-11 33 34)"
            fill="#DBEAFE"
          />
          <rect
            x="36"
            y="49"
            width="38"
            height="4"
            rx="2"
            transform="rotate(-11 36 49)"
            fill="#94A3B8"
            fillOpacity="0.6"
          />
          <rect
            x="38"
            y="58"
            width="32"
            height="4"
            rx="2"
            transform="rotate(-11 38 58)"
            fill="#CBD5E1"
          />
          <rect
            x="40"
            y="67"
            width="28"
            height="4"
            rx="2"
            transform="rotate(-11 40 67)"
            fill="#CBD5E1"
          />
        </g>

        {/* Right tilted sheet: Foto del libro de texto */}
        <g className="docs-art-card-right">
          <rect
            x="122"
            y="16"
            width="64"
            height="78"
            rx="10"
            transform="rotate(11 122 16)"
            fill="#FFFDF9"
            stroke="#E7D3B0"
            strokeWidth="1.5"
          />
          {/* Mini photo landscape frame inside card */}
          <rect
            x="129"
            y="27"
            width="46"
            height="32"
            rx="6"
            transform="rotate(11 129 27)"
            fill="#FBF4E6"
            stroke="#E6C994"
            strokeWidth="1.2"
          />
          <circle cx="159" cy="40" r="4" fill="#D9A441" />
          <path
            d="M127 54 L141 44 L152 54 L161 48 L170 60 L127 54Z"
            fill="#9BC4A7"
            fillOpacity="0.65"
          />
          <rect
            x="123"
            y="67"
            width="34"
            height="4"
            rx="2"
            transform="rotate(11 123 67)"
            fill="#D6C7AE"
          />
          <rect
            x="121"
            y="75"
            width="24"
            height="4"
            rx="2"
            transform="rotate(11 121 75)"
            fill="#E5DCCB"
          />
        </g>

        {/* Front hero card: Planeación semanal (PDF / NEM) */}
        <g className="docs-art-card-center">
          <rect
            x="64"
            y="10"
            width="78"
            height="94"
            rx="12"
            fill="#FFFFFF"
            stroke="#1F6F54"
            strokeOpacity="0.32"
            strokeWidth="1.6"
          />
          {/* Warm clay header strip */}
          <rect x="73" y="20" width="60" height="12" rx="4" fill="#EFE6E2" />
          <rect x="78" y="24" width="32" height="4" rx="2" fill="#964E3B" />
          <rect x="115" y="23" width="13" height="6" rx="3" fill="#964E3B" fillOpacity="0.22" />

          {/* Checklist rows representing lesson plan structure */}
          <circle cx="79" cy="44" r="4" fill="#EDF5EF" stroke="#1F6F54" strokeWidth="1.3" />
          <path d="M77.3 44.1L78.6 45.4L81 42.9" stroke="#1F6F54" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="88" y="42" width="42" height="4.5" rx="2.25" fill="#1C1C1A" fillOpacity="0.72" />

          <circle cx="79" cy="58" r="4" fill="#EDF5EF" stroke="#1F6F54" strokeWidth="1.3" />
          <path d="M77.3 58.1L78.6 59.4L81 56.9" stroke="#1F6F54" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="88" y="56" width="36" height="4.5" rx="2.25" fill="#68665F" fillOpacity="0.55" />

          <circle cx="79" cy="72" r="4" fill="#FBF4E6" stroke="#C48A1E" strokeWidth="1.3" />
          <rect x="88" y="70" width="40" height="4.5" rx="2.25" fill="#68665F" fillOpacity="0.4" />

          <rect x="74" y="85" width="26" height="9" rx="4.5" fill="#EDF5EF" />
          <rect x="79" y="88.5" width="16" height="2.4" rx="1.2" fill="#1F6F54" />
        </g>

        {/* Floating Emerald Upload Medallion */}
        <g className="docs-art-badge">
          <circle cx="143" cy="86" r="17" fill="#1F6F54" />
          <circle cx="143" cy="86" r="17" stroke="#FFFFFF" strokeWidth="3" />
          <path
            d="M143 92V80M138.5 84.5L143 80L147.5 84.5"
            stroke="#FFFFFF"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Subtle editorial sparkle */}
        <path
          d="M47 18L48.5 22L52.5 23.5L48.5 25L47 29L45.5 25L41.5 23.5L45.5 22L47 18Z"
          fill="#C48A1E"
          fillOpacity="0.85"
        />
      </svg>
    </div>
  );
}

/** Warm open archival folder illustration for empty document library. */
export function EmptyLibraryIllustration() {
  return (
    <div className="docs-empty-art" aria-hidden="true">
      <svg
        width="108"
        height="76"
        viewBox="0 0 108 76"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="54" cy="68" rx="38" ry="5" fill="#1C1C1A" fillOpacity="0.06" />
        <path
          d="M18 22C18 18.7 20.7 16 24 16H42L47 22H84C87.3 22 90 24.7 90 28V58C90 61.3 87.3 64 84 64H24C20.7 64 18 61.3 18 58V22Z"
          fill="#EFECE4"
          stroke="#D2D0C8"
          strokeWidth="1.5"
        />
        {/* Dashed paper waiting inside */}
        <rect
          x="33"
          y="10"
          width="42"
          height="36"
          rx="6"
          fill="#FFFFFF"
          stroke="#1F6F54"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <rect x="41" y="19" width="26" height="3.5" rx="1.75" fill="#964E3B" fillOpacity="0.45" />
        <rect x="41" y="27" width="20" height="3.5" rx="1.75" fill="#D2D0C8" />
        {/* Front folder flap */}
        <path
          d="M15 33C15 30.2 17.2 28 20 28H88C90.8 28 93 30.2 93 33L89.5 58.5C89.1 61.6 86.4 64 83.3 64H24.7C21.6 64 18.9 61.6 18.5 58.5L15 33Z"
          fill="#FAF8F3"
          stroke="#C8C4B8"
          strokeWidth="1.5"
        />
        <rect x="42" y="42" width="24" height="4" rx="2" fill="#D2D0C8" />
      </svg>
    </div>
  );
}

/** Visual diagram showing a teacher's lesson plan transforming into a printable classroom sheet. */
export function DocumentToWorksheetIllustration() {
  return (
    <div className="docs-flow-art" aria-hidden="true">
      <svg
        width="244"
        height="104"
        viewBox="0 0 244 104"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Source document card */}
        <rect
          x="10"
          y="16"
          width="74"
          height="74"
          rx="12"
          fill="#FAF8F3"
          stroke="#D2D0C8"
          strokeWidth="1.5"
        />
        <rect x="20" y="26" width="26" height="9" rx="4.5" fill="#EFE6E2" />
        <rect x="25" y="29.5" width="16" height="2" rx="1" fill="#964E3B" />
        <rect x="20" y="42" width="52" height="4" rx="2" fill="#8E8B83" fillOpacity="0.45" />
        <rect x="20" y="51" width="46" height="4" rx="2" fill="#8E8B83" fillOpacity="0.35" />
        <rect x="20" y="60" width="50" height="4" rx="2" fill="#8E8B83" fillOpacity="0.35" />
        <rect x="20" y="69" width="34" height="4" rx="2" fill="#8E8B83" fillOpacity="0.25" />

        {/* Curved transformation arrow + sparkle */}
        <path
          d="M94 53C108 53 116 53 136 53"
          stroke="#1F6F54"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
        <path
          d="M131 47L138 53L131 59"
          stroke="#1F6F54"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="114" cy="34" r="11" fill="#EDF5EF" stroke="#9BC4A7" strokeWidth="1.2" />
        <path
          d="M114 28L115.4 31.8L119.2 33.2L115.4 34.6L114 38.4L112.6 34.6L108.8 33.2L112.6 31.8L114 28Z"
          fill="#1F6F54"
        />

        {/* Output worksheet card ready to print */}
        <rect
          x="150"
          y="10"
          width="84"
          height="84"
          rx="13"
          fill="#FFFFFF"
          stroke="#1F6F54"
          strokeOpacity="0.4"
          strokeWidth="1.6"
        />
        <rect x="160" y="20" width="64" height="12" rx="4" fill="#EDF5EF" />
        <rect x="166" y="24.5" width="38" height="3.2" rx="1.6" fill="#1F6F54" />
        {/* Activity items */}
        <rect x="160" y="40" width="8" height="8" rx="2.5" stroke="#1F6F54" strokeWidth="1.4" />
        <path d="M162.3 44L163.6 45.3L166.1 42.7" stroke="#1F6F54" strokeWidth="1.3" strokeLinecap="round" />
        <rect x="173" y="42" width="48" height="4" rx="2" fill="#1C1C1A" fillOpacity="0.65" />

        <rect x="160" y="54" width="8" height="8" rx="2.5" stroke="#964E3B" strokeWidth="1.4" />
        <rect x="173" y="56" width="40" height="4" rx="2" fill="#68665F" fillOpacity="0.5" />

        <rect x="160" y="68" width="8" height="8" rx="2.5" stroke="#C48A1E" strokeWidth="1.4" />
        <rect x="173" y="70" width="44" height="4" rx="2" fill="#68665F" fillOpacity="0.4" />

        {/* Mini ready badge */}
        <circle cx="225" cy="84" r="10" fill="#964E3B" stroke="#FFFFFF" strokeWidth="2.5" />
        <path
          d="M221.5 84.3L223.8 86.6L228.5 81.8"
          stroke="#FFFFFF"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
