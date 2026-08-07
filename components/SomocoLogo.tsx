'use client'

export default function SomocoLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" stroke="#2a2a2a" strokeWidth="1" />
      <circle cx="16" cy="16" r="10" stroke="#444" strokeWidth="1" />
      <circle cx="16" cy="16" r="5" stroke="#c8f135" strokeWidth="1.5" />
      <path d="M16 4 A12 12 0 0 1 26 22" stroke="#c8f135" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="#c8f135" />
    </svg>
  )
}
