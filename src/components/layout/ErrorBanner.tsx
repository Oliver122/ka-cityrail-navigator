import "./ErrorBanner.css";

type Props = {
  message: string;
};

export default function ErrorBanner({ message }: Props) {
  return (
    <div className="error-banner">
      <span>{message}</span>
    </div>
  );
}
