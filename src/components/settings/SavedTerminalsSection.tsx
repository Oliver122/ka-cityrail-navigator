import type { Stop } from "../../storage";
import { CloseIcon, PlusIcon, RefreshIcon, SearchIcon, StarIcon } from "../Icons";

type Props = {
  starred: Stop[];
  query: string;
  searchResults: Stop[];
  searching: boolean;
  searchError: string | null;
  onQueryChange: (value: string) => void;
  onAdd: (stop: Stop) => void;
  onRemove: (id: string) => void;
};

export default function SavedTerminalsSection({
  starred,
  query,
  searchResults,
  searching,
  searchError,
  onQueryChange,
  onAdd,
  onRemove,
}: Props) {
  const starredIds = new Set(starred.map((s) => s.id));

  return (
    <section className="config-section">
      <div className="section-header">
        <StarIcon filled className="section-icon starred-icon" />
        <h2>Saved Terminals</h2>
        {starred.length > 0 && (
          <span className="section-count">{starred.length} active</span>
        )}
      </div>

      <div className="terminal-search">
        <SearchIcon className="search-icon" />
        <input
          type="text"
          placeholder="Search stations..."
          value={query}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
        />
        {searching && <RefreshIcon className="search-spinner" />}
      </div>

      {searchError && <p className="config-error">{searchError}</p>}

      {searchResults.length > 0 && (
        <ul className="search-results-list">
          {searchResults.map((s) => (
            <li key={s.id} className="search-result-item">
              <span className="result-name">{s.name}</span>
              <button
                className={`add-button${starredIds.has(s.id) ? " added" : ""}`}
                onClick={() => onAdd(s)}
                disabled={starredIds.has(s.id)}
              >
                {starredIds.has(s.id) ? (
                  <>
                    <StarIcon filled />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <PlusIcon />
                    <span>Add</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {starred.length === 0 ? (
        <p className="empty-state">No saved terminals yet. Search above to add some.</p>
      ) : (
        <ul className="terminals-list">
          {starred.map((s) => (
            <li key={s.id} className="terminal-item">
              <div className="terminal-info">
                <span className="terminal-name">{s.name}</span>
                <span className="terminal-coords">
                  {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                </span>
              </div>
              <button className="remove-button" onClick={() => onRemove(s.id)} title="Remove">
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
