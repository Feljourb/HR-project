// "fatima.zahra" -> "FZ"
function initials(username: string) {
  return username
    .split(".")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({ username, className = "" }: { username: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-xs font-bold ${className}`}>
      {initials(username)}
    </span>
  );
}
