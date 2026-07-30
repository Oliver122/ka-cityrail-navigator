import { ChevronLeftIcon, MenuIcon, ShareIcon } from "../Icons";

type Props = {
  onBack: () => void;
};

export default function DetailsHeader({ onBack }: Props) {
  return (
    <header className="details-header">
      <button className="icon-button" type="button" onClick={onBack}>
        <ChevronLeftIcon />
      </button>
      <h1>Departure Details</h1>
      <div className="header-actions">
        <button className="icon-button" type="button">
          <ShareIcon />
        </button>
        <button className="icon-button" type="button">
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
