import Coin from "@/components/Coin";

/**
 * The big-win ceremony coin: a 30px Jewel coin that stamps in under a finite
 * gold halo (see .bcoin-ceremony in globals.css), then settles into the idle
 * flip. Used at the wheel's jackpot/top segment, the slot big win and the
 * scratch jackpot. The dir="ltr" island keeps coin order stable in Arabic —
 * the same treatment as every signed-number row. Layout spacing stays at the
 * call site via `className`.
 */
export default function CeremonyCoin({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span dir="ltr" className={`inline-flex items-center justify-center ${className}`}>
      <Coin variant="b" size={size} className="bcoin-lg bcoin-ceremony" />
    </span>
  );
}
