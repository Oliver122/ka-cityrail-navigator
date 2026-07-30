export default function FactoryResetSection() {
  return (
    <section className="config-section danger-section">
      <button className="danger-button" type="button">
        Factory Reset
      </button>
      <p className="danger-hint">This will clear all saved data and settings.</p>
    </section>
  );
}
