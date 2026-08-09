const pageNumber = (label: string): number | null => {
  const match = label.trim().match(/^(?:page\s*)?(\d+)$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return value >= 2 && value <= 5 ? value : null;
};

export const numericPaginationTargets = (labels: string[]): number[] => (
  [...new Set(labels.map(pageNumber).filter((value): value is number => value !== null))].sort((a, b) => a - b)
);
