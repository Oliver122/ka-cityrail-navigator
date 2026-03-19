import "./LineBadge.css";

const MOT_COLORS: Record<string, string> = {
  "1": "#009060", // S-Bahn (green)
  "2": "#0066CC", // Stadtbahn / U-Bahn (blue)
  "4": "#cc0000", // Tram (red)
  "5": "#8B7FE8", // Bus (purple)
};
const MOT_COLOR_DEFAULT = "#6b7280";

interface Props {
  line: string;
  motType: string;
  size?: "small" | "medium" | "large";
}

export default function LineBadge({ line, motType, size = "medium" }: Props) {
  const color = MOT_COLORS[motType] ?? MOT_COLOR_DEFAULT;
  
  return (
    <span 
      className={`line-badge line-badge-${size}`} 
      style={{ backgroundColor: color }}
    >
      {line}
    </span>
  );
}

export function getMotColor(motType: string): string {
  return MOT_COLORS[motType] ?? MOT_COLOR_DEFAULT;
}
