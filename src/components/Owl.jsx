export default function Owl({ size = 32 }) {
  return (
    <svg className="owl" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path className="body" d="M6 9 10 4 13 8Q16 7 19 8L22 4 26 9Q28 13 27 19 25 28 16 29 7 28 5 19 4 13 6 9Z" />
      <circle className="eye" cx="11.5" cy="15" r="4.3" /><circle className="eye" cx="20.5" cy="15" r="4.3" />
      <circle className="pupil" cx="11.5" cy="15" r="1.8" /><circle className="pupil" cx="20.5" cy="15" r="1.8" />
      <path className="beak" d="M14.6 19.4 16 22.2 17.4 19.4Z" />
    </svg>
  );
}
