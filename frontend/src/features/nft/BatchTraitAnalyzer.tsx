import { useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Dropzone } from '../../components/ui/Dropzone'
import { IconSparkles } from '../../components/ui/icons'
import { aiTraitsApi, type BatchAnalysisResult } from '../../lib/nftApi'
import { RarityBadge } from './ui/RarityBadge'
import { COLOR_HEX } from './ui/colorHex'

interface Props {
  token: string
}

// A pre-upload planning tool, distinct from the per-trait AI suggestion
// already inline in LayerCard's upload form: analyze a whole batch of
// candidate images together — real CV analysis for every image, plus a
// real AI-vision pass per image when an OpenAI key is configured — to see
// the resulting rarity/diversity spread across the batch before deciding
// which ones to actually upload to a layer and at what weights. Nothing
// here is persisted; it wires up POST /nft/analyze/batch, which existed on
// the backend with no caller before this.
export function BatchTraitAnalyzer({ token }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BatchAnalysisResult | null>(null)

  const handleAnalyze = async () => {
    if (files.length === 0) return
    setIsAnalyzing(true)
    setError(null)
    try {
      setResult(await aiTraitsApi.analyzeBatch(token, files))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-lg font-medium text-ink">
        <IconSparkles className="h-4 w-4 text-accent-400" />
        Bulk trait analysis
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Drop a batch of candidate trait images to see their real, computed rarity and diversity spread before
        deciding which ones to upload and at what weights. Nothing here is saved — a planning tool, separate from
        actually uploading traits to a layer.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="h-16 w-16 shrink-0">
          <Dropzone compact multiple onFiles={setFiles} hint={files.length > 0 ? `${files.length} selected` : undefined} />
        </div>
        {files.length > 0 && (
          <button onClick={() => setFiles([])} className="text-xs text-ink-faint hover:text-ink-muted">
            Clear
          </button>
        )}
        <Button variant="primary" size="sm" onClick={handleAnalyze} disabled={files.length === 0} isLoading={isAnalyzing}>
          Analyze{files.length > 0 ? ` ${files.length} image${files.length === 1 ? '' : 's'}` : ''}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {result && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-ink-faint">
            <span>
              {result.total_images} image{result.total_images === 1 ? '' : 's'} analyzed
            </span>
            <span>Diversity score: {result.collection_insights.diversity_score.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {result.results.map((analysis, index) => (
              // analysis_id is a hash of the image's raw bytes (see
              // ai_traits._generate_analysis_id) — two byte-identical
              // images in the same batch (e.g. the same file picked twice)
              // collide on it, so the index has to be part of the key too.
              <div key={`${index}-${analysis.analysis_id}`} className="rounded-md border border-border bg-canvas p-2">
                <p className="truncate text-xs font-medium text-ink" title={analysis.filename}>
                  {analysis.filename}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <RarityBadge tier={analysis.suggested_rarity} />
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-border-strong"
                    style={{ backgroundColor: COLOR_HEX[analysis.traits.dominant_color] ?? COLOR_HEX.unknown }}
                  />
                </div>
                <p className="mt-1 truncate text-[11px] capitalize text-ink-faint">{analysis.traits.art_style}</p>
                {analysis.ai_error && (
                  <p className="mt-1 text-[10px] text-danger" title={analysis.ai_error}>
                    AI vision unavailable
                  </p>
                )}
              </div>
            ))}
          </div>

          {Object.keys(result.collection_insights.most_common_traits).length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink">Most common across this batch</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {Object.entries(result.collection_insights.most_common_traits).map(([trait, info]) => (
                  <span key={trait} className="rounded bg-surface-hover px-2 py-0.5 text-[11px] text-ink-muted">
                    {trait}: {info.value} ({info.percentage.toFixed(0)}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
