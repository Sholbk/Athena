export default function Soon({ title, what }) {
  return (
    <article className="panel soon">
      <p className="eyebrow">Coming next</p>
      <h2>{title}</h2>
      <p className="muted">{what}</p>
    </article>
  );
}
