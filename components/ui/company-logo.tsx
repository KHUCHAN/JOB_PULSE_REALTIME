import type { ReactElement } from "react";

const logoByCompany: Record<string, string> = {
  airbnb: "airbnb",
  atlassian: "atlassian",
  block: "block",
  "bristol myers squibb": "bristol-myers-squibb",
  cloudflare: "cloudflare",
  coinbase: "coinbase",
  datadog: "datadog",
  etsy: "etsy",
  figma: "figma",
  genentech: "genentech",
  github: "github",
  merck: "merck",
  metlife: "metlife",
  notion: "notion",
  palantir: "palantir",
  snowflake: "snowflake",
  stripe: "stripe",
  toyota: "toyota",
};

export function CompanyLogo({ company, large = false }: { company: string; large?: boolean }): ReactElement {
  const logo = logoByCompany[company.toLowerCase()];

  if (!logo) {
    return <span className={`company-avatar ${large ? "large" : ""}`} aria-hidden="true">{company.slice(0, 1)}</span>;
  }

  return (
    <span className={`company-avatar company-logo ${large ? "large" : ""}`} aria-hidden="true">
      {/* Small local brand assets intentionally skip the image proxy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/company-logos/${logo}.png`} alt="" width={large ? 40 : 32} height={large ? 40 : 32} />
    </span>
  );
}
