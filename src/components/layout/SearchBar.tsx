import { CloseIcon, FilterIcon, RefreshIcon, SearchIcon } from "../Icons";
import "./SearchBar.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searching?: boolean;
};

export default function SearchBar({
  value,
  onChange,
  placeholder = "Search all stations...",
  searching = false,
}: Props) {
  return (
    <div className="search-bar">
      <SearchIcon className="search-icon" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {searching && <RefreshIcon className="search-spinner" />}
      {value.length > 0 && !searching && (
        <button
          className="search-clear"
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <CloseIcon />
        </button>
      )}
      <button className="filter-button" type="button">
        <FilterIcon />
      </button>
    </div>
  );
}
