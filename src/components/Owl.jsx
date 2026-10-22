// Athena's mark: the figure from her logo (public/athena-mark.png), drawn in the theme's accent color
// through a CSS mask so it follows the palette in light and dark mode. The name stays Owl for history.
export default function Owl({ size = 44 }) {
  return <span className="mark" style={{ height: size, width: Math.round(size * 0.4625) }} role="img" aria-label="Athena" />;
}
