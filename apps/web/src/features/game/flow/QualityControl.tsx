import type { QualityPreset } from '../scene/quality-presets';
export function QualityControl({
  value,
  onChange,
}: {
  value: QualityPreset;
  onChange(value: QualityPreset): void;
}) {
  return (
    <label className="quality-control">
      화면 품질{' '}
      <select value={value} onChange={(event) => onChange(event.target.value as QualityPreset)}>
        <option value="medium">기본</option>
        <option value="low">가볍게</option>
      </select>
    </label>
  );
}
