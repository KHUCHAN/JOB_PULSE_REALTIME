const favicon = `
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="24" height="24" rx="6" fill="#0B1D36"/>
  <path d="M21 18.5455C21 19.9011 19.9011 21 18.5455 21H14.4545C13.0989 21 12 19.9011 12 18.5455V12H18.5455C19.9011 12 21 13.0989 21 14.4545V18.5455Z" fill="#68C4FF"/>
  <path d="M18.5 3C19.3284 3 20 3.67157 20 4.5V6.5C20 7.32843 19.3284 8 18.5 8H16.5C15.6716 8 15 7.32843 15 6.5V4.5C15 3.67157 15.6716 3 16.5 3H18.5Z" fill="#2E9EFF"/>
  <path d="M7.5 16C8.32843 16 9 16.6716 9 17.5V19.5C9 20.3284 8.32843 21 7.5 21H5.5C4.67157 21 4 20.3284 4 19.5V17.5C4 16.6716 4.67157 16 5.5 16H7.5Z" fill="#2E9EFF"/>
  <path d="M12 12H5.45455C4.09894 12 3 10.9011 3 9.54545V5.45455C3 4.09894 4.09894 3 5.45455 3H9.54545C10.9011 3 12 4.09894 12 5.45455V12Z" fill="#3478F6"/>
</svg>`.trim();

export function GET(): Response {
  return new Response(favicon, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
