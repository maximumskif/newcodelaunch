import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { Stepper } from '../../components/ui/Stepper'
import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { CollectionSidebar } from './CollectionSidebar'
import { GenerateStep } from './GenerateStep'
import { LayerEditor } from './LayerEditor'

export function NFTGeneratorPage() {
  const { accessToken } = useAuth()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')

  const [collections, setCollections] = useState<NFTCollection[]>([])
  const [isLoadingCollections, setIsLoadingCollections] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collection, setCollection] = useState<NFTCollection | null>(null)
  const [isLoadingCollection, setIsLoadingCollection] = useState(false)
  const [project, setProject] = useState<Project | null>(null)

  const refreshCollections = async (token: string) => {
    setIsLoadingCollections(true)
    try {
      const { collections: fetched } = await nftApi.listCollections(token)
      setCollections(fetched)
      setSelectedId((current) => current ?? fetched[0]?.id ?? null)
    } finally {
      setIsLoadingCollections(false)
    }
  }

  const refreshCollection = async (token: string, id: string) => {
    setIsLoadingCollection(true)
    try {
      const { collection: fetched } = await nftApi.getCollection(token, id)
      setCollection(fetched)
    } finally {
      setIsLoadingCollection(false)
    }
  }

  useEffect(() => {
    if (accessToken) void refreshCollections(accessToken)
  }, [accessToken])

  // Resume: arriving via ?project= either jumps straight to the collection
  // that project already links to, or (if it's still a bare draft) leaves
  // selection alone and lets CollectionSidebar pre-fill the create form.
  useEffect(() => {
    if (!accessToken || !projectId) return
    let cancelled = false
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => {
      if (cancelled) return
      setProject(fetched)
      if (fetched.nft_collection) setSelectedId(fetched.nft_collection.id)
    })
    return () => {
      cancelled = true
    }
  }, [accessToken, projectId])

  useEffect(() => {
    if (accessToken && selectedId) void refreshCollection(accessToken, selectedId)
    else setCollection(null)
  }, [accessToken, selectedId])

  const layers = collection?.layers ?? []
  const hasTraitsEverywhere = layers.length > 0 && layers.every((layer) => layer.traits.length > 0)
  const activeId = hasTraitsEverywhere ? 'generate' : 'layers'

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 3"
        title="NFT Collection Generator"
        description="Build a layered trait system with AI-assisted rarity suggestions, composite real artwork with rarity-weighted generation, and publish straight to IPFS — no fake URLs, no round-robin trait picking."
      />

      {!accessToken ? (
        <Card padding="lg" className="text-center">
          <p className="text-ink-muted">Connect and sign in with a wallet above to create and manage collections.</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <CollectionSidebar
            token={accessToken}
            collections={collections}
            selectedId={selectedId}
            isLoading={isLoadingCollections}
            onSelect={setSelectedId}
            onCreated={(created) => {
              setCollections((prev) => [created, ...prev])
              setSelectedId(created.id)
            }}
            projectId={project && !project.nft_collection ? project.id : null}
            initialName={project && !project.nft_collection ? project.name : undefined}
          />

          <div className="space-y-5">
            {!collection ? (
              <EmptyState
                title={isLoadingCollection ? 'Loading…' : 'Pick a collection on the left, or create a new one.'}
              />
            ) : (
              <>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-ink">{collection.name}</h2>
                      {collection.description && <p className="mt-1 text-sm text-ink-muted">{collection.description}</p>}
                    </div>
                    <Stepper
                      activeId={activeId}
                      steps={[
                        { id: 'layers', label: 'Layers & traits', done: hasTraitsEverywhere },
                        { id: 'generate', label: 'Generate & publish', done: collection.status === 'published' },
                      ]}
                    />
                  </div>
                </Card>

                <LayerEditor
                  token={accessToken}
                  collection={collection}
                  onChange={() => void refreshCollection(accessToken, collection.id)}
                />

                <GenerateStep token={accessToken} collection={collection} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
