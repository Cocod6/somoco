'use client'

// Somoco — Submit a prediction
// Type free text → AI parses it into a Triple → review → submit to Intuition.
//
// Two extras beyond the basic flow:
//   • Curated creator gating — a connected wallet must clear the minimum trust
//     score (see hooks/useCurrentUser) before it can submit on-chain.
//   • Cart / batch submit — queue several predictions and push them all in one
//     pair of transactions (see lib/predictions/batchOnchain).

import { useRef, useState } from 'react'
import { useWalletClient, usePublicClient, useChainId } from 'wagmi'
import type { Hex } from 'viem'
import type { ParseResponse } from '@/lib/predictions/types'
import { submitPredictionOnChain } from '@/lib/predictions/onchain'
import { submitBatchOnChain, type BatchPredictionItem } from '@/lib/predictions/batchOnchain'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useIsEmbeddedWallet } from '@/hooks/useIsEmbeddedWallet'
import {
  uploadPredictionImage,
  deletePredictionImage,
  validateImage,
  type UploadedImage,
} from '@/lib/predictions/imageUpload'

type Step = 'input' | 'parsing' | 'confirm' | 'submitting' | 'success'

const METHOD_LABELS: Record<string, string> = {
  automated_feed: '⚙ automated data feed',
  named_source: '◈ named source',
  human_review: '👁 human review',
}

interface CartItem {
  key: number
  result: ParseResponse
  /** Image attached to THIS prediction — each cart item keeps its own */
  image: UploadedImage | null
}

/** Build the on-chain batch item (with Atom reuse) from a parsed prediction. */
function toBatchItem(r: ParseResponse): BatchPredictionItem {
  return {
    existingSubjectAtomId: (r.subjectMatches[0]?.atomId as Hex) ?? null,
    subjectLabel: r.parsed.subject,
    existingPredicateAtomId: (r.predicateMatches[0]?.atomId as Hex) ?? null,
    claimLabel: r.parsed.claim,
    existingObjectAtomId: (r.objectMatches[0]?.atomId as Hex) ?? null,
    conditionLabel: r.parsed.condition || 'no condition',
  }
}

/** Build the Somoco DB row from a parsed prediction + its on-chain Triple id. */
function toDbRow(r: ParseResponse, tripleId: string, address: string, imageUrl: string | null) {
  return {
    triple_id: tripleId,
    creator_address: address,
    subject: r.parsed.subject,
    claim: r.parsed.claim,
    condition: r.parsed.condition || null,
    category: r.parsed.category || null,
    resolution_date: r.parsed.resolutionDate,
    // NOTE: approval_status is never set here — the DB default is 'pending',
    // so a needsReview-flagged prediction can only go live via the admin
    // Approve queue. Never auto-approve.
    resolution_plan: r.resolutionPlan ?? null,
    image_url: imageUrl,
  }
}

/**
 * Saves prediction rows to Somoco's approval queue via the server route.
 * Returns the error message, or null on success.
 *
 * This goes through /api/predictions rather than writing to Supabase directly:
 * RLS now blocks client writes, and the server owns approval_status so nothing
 * can submit itself pre-approved. The missing-optional-column retry that used
 * to live here moved into that route alongside the insert.
 */
async function insertPredictionRows(rows: ReturnType<typeof toDbRow>[]): Promise<string | null> {
  try {
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    if (res.ok) return null

    const { error } = await res.json().catch(() => ({ error: res.statusText }))
    return error ?? 'Could not save prediction.'
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not reach the server to save prediction.'
  }
}

export default function SubmitPrediction({ isConnected, address }: { isConnected: boolean; address?: string }) {
  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  // Optional user guidance on HOW the prediction should resolve
  const [resolutionNote, setResolutionNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [result, setResult] = useState<ParseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [submittedCount, setSubmittedCount] = useState(0)
  // bytes32 Triple ids created this submission — used for the portal links
  const [tripleIds, setTripleIds] = useState<string[]>([])

  // Optional image attached to the prediction being written right now.
  // Uploaded as soon as it's picked so the preview is the real stored file and
  // submitting is just a URL — abandoned uploads are cleaned up on remove.
  const [image, setImage] = useState<UploadedImage | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [cart, setCart] = useState<CartItem[]>([])
  const nextKey = useRef(1)

  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { user, loading: userLoading, trustScore, isEligible, minTrustScore } = useCurrentUser()
  const isEmbedded = useIsEmbeddedWallet(address)

  // Only block when we actually KNOW the wallet is ineligible (connected + loaded).
  // Embedded (email/social) wallets are exempt: they start with zero on-chain
  // history so they'd never clear the score, and we want to onboard them.
  const eligibilityBlocked = isConnected && !!user && !isEligible && !isEmbedded

  const charCount = text.length
  const canParse = charCount >= 10 && charCount <= 280

  const requireWallet = (): boolean => {
    if (!isConnected || !walletClient || !publicClient) {
      alert('Please connect your wallet first using the button in the top right.')
      return false
    }
    if (eligibilityBlocked) {
      setError(`Your trust score is ${trustScore}. You need at least ${minTrustScore} to submit predictions.`)
      return false
    }
    return true
  }

  const handleParse = async () => {
    if (!canParse) return
    setStep('parsing')
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/parse-prediction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, userResolutionNote: resolutionNote.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data?.error ?? 'Parsing failed. Try again.')
        setStep('input')
        return
      }

      setResult(data as ParseResponse)
      setStep('confirm')
    } catch {
      setError('Could not reach the parser. Is the dev server running?')
      setStep('input')
    }
  }

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input straight away so picking the SAME file again re-fires change.
    e.target.value = ''
    if (!file) return

    setImageError(null)
    const problem = validateImage(file)
    if (problem) {
      setImageError(problem)
      return
    }

    // Replacing an existing image? Bin the old file rather than orphan it.
    const previous = image
    setImageUploading(true)
    try {
      const uploaded = await uploadPredictionImage(file, address ?? '')
      setImage(uploaded)
      if (previous) void deletePredictionImage(previous.path)
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'image upload failed')
    } finally {
      setImageUploading(false)
    }
  }

  const handleRemoveImage = () => {
    if (image) void deletePredictionImage(image.path)
    setImage(null)
    setImageError(null)
  }

  const handleAddToCart = () => {
    if (!result) return
    setCart(prev => [...prev, { key: nextKey.current++, result, image }])
    setResult(null)
    setText('')
    setResolutionNote('')
    // The image travels with the cart item — clear it WITHOUT deleting the file.
    setImage(null)
    setImageError(null)
    setError(null)
    setStep('input')
  }

  const handleRemoveFromCart = (key: number) => {
    setCart(prev => {
      const removed = prev.find(item => item.key === key)
      if (removed?.image) void deletePredictionImage(removed.image.path)
      return prev.filter(item => item.key !== key)
    })
  }

  // Single-submit: the currently-reviewed prediction, on its own.
  const handleSubmitOne = async () => {
    if (!result) return
    if (!requireWallet() || !walletClient || !publicClient) return

    setStep('submitting')
    setError(null)

    try {
      const onChain = await submitPredictionOnChain({
        publicClient,
        walletClient,
        chainId,
        existingSubjectAtomId: (result.subjectMatches[0]?.atomId as Hex) ?? null,
        subjectLabel: result.parsed.subject,
        existingPredicateAtomId: (result.predicateMatches[0]?.atomId as Hex) ?? null,
        claimLabel: result.parsed.claim,
        existingObjectAtomId: (result.objectMatches[0]?.atomId as Hex) ?? null,
        conditionLabel: result.parsed.condition || 'no condition',
      })

      setTxHash(onChain.txHash)
      setTripleIds([onChain.tripleId])

      const dbError = await insertPredictionRows([
        toDbRow(result, onChain.tripleId, address ?? '', image?.url ?? null),
      ])
      if (dbError) {
        // The Triple is already real on-chain; this only affects the approval queue.
        console.error('Could not save prediction record:', dbError)
      }

      setSubmittedCount(1)
      // Clear WITHOUT deleting — the file is referenced by the row we just saved.
      setImage(null)
      setStep('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed.'
      setError(`On-chain submission failed: ${message}`)
      setStep('confirm')
    }
  }

  // Batch-submit: everything currently in the cart, in one pair of transactions.
  const handleSubmitCart = async () => {
    if (cart.length === 0) return
    if (!requireWallet() || !walletClient || !publicClient) return

    setStep('submitting')
    setError(null)

    try {
      const batch = await submitBatchOnChain({
        publicClient,
        walletClient,
        chainId,
        items: cart.map(item => toBatchItem(item.result)),
      })

      setTxHash(batch.txHash)
      setTripleIds(batch.triples.map(t => t.tripleId))

      const rows = cart.map((item, i) =>
        toDbRow(item.result, batch.triples[i].tripleId, address ?? '', item.image?.url ?? null),
      )
      const dbError = await insertPredictionRows(rows)
      if (dbError) {
        console.error('Could not save batch prediction records:', dbError)
      }

      setSubmittedCount(cart.length)
      setCart([])
      setStep('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed.'
      setError(`Batch submission failed: ${message}`)
      setStep('input')
    }
  }

  const handleReset = () => {
    setStep('input')
    setText('')
    setResolutionNote('')
    setResult(null)
    setError(null)
    // Deliberately does NOT clear `image`: on the "edit" path the user is going
    // back to rewrite their text and should keep the picture they attached. The
    // success path clears it (without deleting) before landing here.
    setImageError(null)
    setTxHash(null)
    setSubmittedCount(0)
    setTripleIds([])
  }

  const parsed = result?.parsed

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 4 }}>
        submit a prediction
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
        {'// type in plain english — somoco parses it with ai'}
      </div>

      {/* Trust score / eligibility banner */}
      {isConnected && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: eligibilityBlocked ? '#1a0f0a' : 'var(--bg-card)',
          border: `1px solid ${eligibilityBlocked ? '#3d2a1a' : 'var(--border)'}`,
          borderRadius: 12, padding: '12px 16px', marginBottom: 16, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            trust score:{' '}
            <span style={{ color: isEligible ? 'var(--accent)' : 'var(--amber)', fontWeight: 700 }}>
              {userLoading ? '…' : trustScore}
            </span>
            {' '}/ {minTrustScore} needed
          </span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: eligibilityBlocked ? '#e6a832' : 'var(--accent-text)' }}>
            {userLoading ? 'checking eligibility…' : eligibilityBlocked ? 'not eligible to submit yet' : 'eligible to submit ✓'}
          </span>
        </div>
      )}

      {/* Cart */}
      {cart.length > 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--accent-border)',
          borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              cart · {cart.length} queued
            </span>
            <button
              onClick={handleSubmitCart}
              disabled={step === 'submitting'}
              className="btn btn-accent"
              style={{ borderRadius: 10, padding: '8px 18px', fontSize: 12 }}
            >
              submit all ({cart.length}) →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cart.map(item => (
              <div key={item.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 10,
                padding: '8px 12px',
              }}>
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image.url}
                    alt=""
                    style={{
                      width: 28, height: 28, objectFit: 'cover', borderRadius: 6,
                      border: '1px solid var(--border)', flexShrink: 0,
                    }}
                  />
                )}
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--blue)' }}>{item.result.parsed.subject}</span>{' · '}
                  <span style={{ color: 'var(--purple)' }}>{item.result.parsed.claim}</span>{' · '}
                  <span style={{ color: 'var(--amber)' }}>{item.result.parsed.condition || 'no condition'}</span>
                </span>
                <button
                  onClick={() => handleRemoveFromCart(item.key)}
                  style={{
                    background: 'transparent', border: 'none', color: '#ff6b6b',
                    cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-mono)',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 10 }}>
            {'// submitted together in one pair of transactions — cheaper gas'}
          </div>
        </div>
      )}

      {/* Input step */}
      {(step === 'input' || step === 'parsing') && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 20, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 10, letterSpacing: '0.5px' }}>
            {'// your prediction'}
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            placeholder="e.g. 'Injective will surpass $50 before end of 2026 if ETF approvals continue in Asia...'"
            disabled={step === 'parsing'}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-sans)', resize: 'none',
              lineHeight: 1.6,
            }}
          />
          {/* Optional: attach an image */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handlePickImage}
              style={{ display: 'none' }}
            />

            {!image && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={step === 'parsing' || imageUploading}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  cursor: imageUploading ? 'wait' : 'pointer',
                  fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: imageUploading ? 'var(--accent-text)' : 'var(--text-dim)',
                }}
              >
                {imageUploading ? '⟳ uploading image…' : '▸ add an image (optional)'}
              </button>
            )}

            {image && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: '#0a0a0a', border: '1px solid var(--border)',
                borderRadius: 10, padding: 10,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt="attached to your prediction"
                  style={{
                    width: 64, height: 64, objectFit: 'cover',
                    borderRadius: 8, border: '1px solid var(--border)',
                  }}
                />
                <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>
                  image attached ✓
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploading}
                  style={{
                    background: 'transparent', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '5px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  {imageUploading ? '⟳' : 'replace'}
                </button>
                <button
                  onClick={handleRemoveImage}
                  disabled={imageUploading}
                  style={{
                    background: 'transparent', border: 'none', color: '#ff6b6b',
                    cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-mono)',
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {imageError && (
              <div style={{
                marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono)', color: '#e6a832',
              }}>
                ⚠ {imageError}
              </div>
            )}
          </div>

          {/* Optional: how should this resolve? */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setShowNote(v => !v)}
              disabled={step === 'parsing'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 12, fontFamily: 'var(--font-mono)',
                color: showNote || resolutionNote ? 'var(--accent-text)' : 'var(--text-dim)',
              }}
            >
              {showNote ? '▾' : '▸'} how should this resolve? (optional)
              {!showNote && resolutionNote && ' ✓'}
            </button>
            {showNote && (
              <textarea
                value={resolutionNote}
                onChange={e => setResolutionNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="e.g. resolves YES if BTC is above $150k on Coinbase at year end"
                disabled={step === 'parsing'}
                style={{
                  width: '100%', marginTop: 8, background: '#0a0a0a',
                  border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px',
                  color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)',
                  resize: 'none', outline: 'none', lineHeight: 1.6,
                }}
              />
            )}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 12, color: charCount > 280 ? '#e24b4a' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {charCount} / 280
            </span>
            <button
              onClick={handleParse}
              disabled={!canParse || step === 'parsing'}
              className="btn btn-accent"
              style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13 }}
            >
              {step === 'parsing' ? '⟳ parsing...' : '⚡ parse with AI'}
            </button>
          </div>
        </div>
      )}

      {step === 'parsing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-text)', fontSize: 13, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span>
          AI is parsing your prediction...
        </div>
      )}

      {error && (
        <div style={{
          color: '#ff4444', fontFamily: 'var(--font-mono)', fontSize: 13,
          marginBottom: 16, padding: '10px 16px', background: '#ff44441a',
          borderRadius: 8, border: '1px solid #ff444433',
        }}>
          {error}
        </div>
      )}

      {/* Confirm step */}
      {step === 'confirm' && parsed && (
        <div style={{
          background: 'var(--accent-dark)', border: '1px solid var(--accent-border)',
          borderRadius: 16, padding: 20, marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' }}>
            {'// parsed triple — review before submitting'}
          </div>

          {/* The attached image, as it'll appear on the prediction */}
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt="attached to your prediction"
              style={{
                width: '100%', maxHeight: 220, objectFit: 'cover',
                borderRadius: 10, border: '1px solid var(--accent-border)',
                display: 'block', marginBottom: 12,
              }}
            />
          )}

          {/* auto-fit, not a hard 3 columns: on a phone the three atoms stack
              instead of being squeezed into 100px-wide slivers. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12, marginBottom: 12,
          }}>
            {[
              { label: 'subject', value: parsed.subject, color: 'var(--blue)' },
              { label: 'claim', value: parsed.claim, color: 'var(--purple)' },
              { label: 'condition', value: parsed.condition || 'none', color: 'var(--amber)' },
            ].map(part => (
              <div key={part.label} style={{
                background: '#0a120a', border: '1px solid var(--accent-border)',
                borderRadius: 10, padding: 14,
              }}>
                <div style={{ fontSize: 10, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
                  {part.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: part.color, lineHeight: 1.4 }}>
                  {part.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: '#0a120a', border: '1px solid var(--accent-border)',
            borderRadius: 10, padding: 14, marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>
                judgment day
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: parsed.resolutionDate ? 'var(--accent)' : '#e6a832' }}>
                {parsed.resolutionDate ?? 'no date detected'}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              resolution Triple created on this date
            </div>
          </div>

          {parsed.needsClarification && parsed.clarificationQuestion && (
            <div style={{
              background: '#1a150a', border: '1px solid #3d2f1a', borderRadius: 10,
              padding: 12, marginBottom: 12, fontSize: 13, color: '#e6a832',
              fontFamily: 'var(--font-mono)',
            }}>
              ⚠ {parsed.clarificationQuestion}
            </div>
          )}

          {/* Atom reuse check */}
          <div style={{
            background: '#0a0f1a', border: '1px solid var(--blue-border)',
            borderRadius: 10, padding: 14, marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, color: 'var(--blue)', fontFamily: 'var(--font-mono)', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
              atom reuse check
            </div>
            {[
              { label: 'subject', text: parsed.subject, found: result?.subjectMatches ?? [] },
              { label: 'predicate', text: parsed.claim, found: result?.predicateMatches ?? [] },
              { label: 'object', text: parsed.condition || 'no condition', found: result?.objectMatches ?? [] },
            ].map(row => (
              <div key={row.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                padding: '6px 0', borderBottom: '1px solid var(--blue-border)',
              }}>
                <span>
                  <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{row.label}</span>
                  {' '}&quot;{row.text}&quot;
                </span>
                <span style={{ color: row.found.length > 0 ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {row.found.length > 0 ? `reuse #${row.found[0].atomId.slice(0, 6)}...` : 'will create new'}
                </span>
              </div>
            ))}
          </div>

          {/* Resolution plan — the contract for how this will be judged */}
          {result?.resolutionPlan && (
            <div style={{
              background: '#0a120a', border: '1px solid var(--accent-border)',
              borderRadius: 10, padding: 14, marginBottom: 12,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 8, marginBottom: 10,
              }}>
                <span style={{ fontSize: 10, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase' }}>
                  {'// how it resolves'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {METHOD_LABELS[result.resolutionPlan.method] ?? result.resolutionPlan.method}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {result.resolutionPlan.sources.map(s => (
                  <span key={s} className="chip-mini">{s}</span>
                ))}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                {result.resolutionPlan.criteria}
              </div>
              {result.resolutionPlan.needsReview && (
                <div style={{
                  background: '#1a150a', border: '1px solid #3d2f1a', borderRadius: 8,
                  padding: 10, marginTop: 10, fontSize: 12, color: '#e6a832',
                  fontFamily: 'var(--font-mono)',
                }}>
                  ⚠ will be held for review: {result.resolutionPlan.reviewReason}
                </div>
              )}
            </div>
          )}

          {!isConnected && (
            <div style={{
              background: '#1a0f0a', border: '1px solid #3d2a1a', borderRadius: 10,
              padding: 12, marginBottom: 16, fontSize: 12, color: '#e6a832',
              fontFamily: 'var(--font-mono)',
            }}>
              ⚠ connect your wallet (top right) to submit on-chain
            </div>
          )}

          {eligibilityBlocked && (
            <div style={{
              background: '#1a0f0a', border: '1px solid #3d2a1a', borderRadius: 10,
              padding: 12, marginBottom: 16, fontSize: 12, color: '#e6a832',
              fontFamily: 'var(--font-mono)',
            }}>
              ⚠ your trust score ({trustScore}) is below the {minTrustScore} needed to submit.
              use the chain more, hold some $TRUST, or create atoms on intuition to raise it.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleSubmitOne} disabled={eligibilityBlocked}
              className="btn btn-accent"
              style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13 }}>
              confirm &amp; submit now
            </button>
            <button onClick={handleAddToCart} disabled={eligibilityBlocked}
              className="btn btn-yes"
              style={{
                borderRadius: 10, padding: '10px 22px', fontSize: 13,
                opacity: eligibilityBlocked ? 0.4 : 1,
                cursor: eligibilityBlocked ? 'not-allowed' : 'pointer',
              }}>
              + add to cart
            </button>
            <button onClick={handleReset}
              className="btn btn-ghost"
              style={{ borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 500 }}>
              edit
            </button>
          </div>
        </div>
      )}

      {/* Submitting */}
      {step === 'submitting' && (
        <div style={{
          background: 'var(--accent-dark)', border: '1px solid var(--accent-border)',
          borderRadius: 16, padding: 32, textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
            submitting to intuition protocol...
          </div>
          <div style={{ fontSize: 12, color: '#555', fontFamily: 'var(--font-mono)' }}>
            confirm the transaction(s) in your wallet — creating atoms + triple(s)
          </div>
        </div>
      )}

      {/* Success */}
      {step === 'success' && (
        <div style={{
          background: 'var(--accent-dark)', border: '1px solid var(--accent-border)',
          borderRadius: 16, padding: 40, textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, background: '#1a2a0a', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 24, color: 'var(--accent)',
          }}>
            ✓
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
            {submittedCount > 1 ? `${submittedCount} predictions submitted` : 'prediction submitted'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', marginBottom: 20 }}>
            {`// atoms + triple${submittedCount > 1 ? 's' : ''} created on intuition protocol`}
          </div>
          {/* View the actual prediction Triple(s) on the Intuition portal */}
          {tripleIds.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {tripleIds.map((id, i) => (
                <a
                  key={id}
                  href={`https://portal.intuition.systems/explore/triple/${id}?tab=positions`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'block', fontSize: 13, color: 'var(--blue)',
                    fontFamily: 'var(--font-mono)', marginBottom: 6, textDecoration: 'underline',
                  }}
                >
                  {tripleIds.length > 1 ? `view prediction ${i + 1} on intuition portal ↗` : 'view on intuition portal ↗'}
                </a>
              ))}
            </div>
          )}
          {txHash && (
            <a
              href={`https://explorer.intuition.systems/tx/${txHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-block', fontSize: 12, color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', marginBottom: 20, textDecoration: 'underline',
              }}
            >
              view transaction on explorer ↗
            </a>
          )}
          <div></div>
          <button onClick={handleReset}
            className="btn btn-accent"
            style={{ borderRadius: 10, padding: '10px 24px', fontSize: 13 }}>
            submit another prediction
          </button>
        </div>
      )}
    </div>
  )
}
