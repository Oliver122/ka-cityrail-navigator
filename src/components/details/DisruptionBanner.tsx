import { AlertIcon } from "../Icons";

type Props = {
  message: string;
};

export default function DisruptionBanner({ message }: Props) {
  return (
    <div className="disruption-banner">
      <AlertIcon className="disruption-icon" />
      <span>{message}</span>
    </div>
  );
}
