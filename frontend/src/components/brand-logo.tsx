import Image from "next/image";

// Official SBD lockup: white monogram (no frame) + name on 3 lines.
// "light" = on the navy background, "dark" = on a white background.
export function BrandLogo({ tone = "light" }: { tone?: "light" | "dark" }) {
  const light = tone === "light";
  return (
    <div className="flex items-center gap-3">
      {light ? (
        <Image src="/logo-white.png" alt="Silent Believers Distribution" width={39} height={45} className="h-10 w-auto shrink-0" />
      ) : (
        <Image src="/logo.png" alt="Silent Believers Distribution" width={56} height={49} className="h-10 w-auto shrink-0 rounded-md" />
      )}
      <div className={`text-[13px] uppercase leading-[1.1] tracking-[0.04em] ${light ? "text-white" : "text-[#192646]"}`}>
        <p className="font-semibold">Silent</p>
        <p className="font-semibold">Believers</p>
        <p className="font-light">Distribution</p>
      </div>
    </div>
  );
}
