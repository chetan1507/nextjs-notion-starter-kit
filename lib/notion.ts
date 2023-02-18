import { ExtendedRecordMap, SearchParams, SearchResults } from 'notion-types'
import { mergeRecordMaps } from 'notion-utils'
import pMap from 'p-map'
import pMemoize from 'p-memoize'

import {
  isPreviewImageSupportEnabled,
  navigationLinks,
  navigationStyle
} from './config'
import { db } from './db'
import { notion } from './notion-api'
import { getPreviewImageMap } from './preview-images'

const getNavigationLinkPages = pMemoize(
  async (): Promise<ExtendedRecordMap[]> => {
    const navigationLinkPageIds = (navigationLinks || [])
      .map((link) => link.pageId)
      .filter(Boolean)

    if (navigationStyle !== 'default' && navigationLinkPageIds.length) {
      return pMap(
        navigationLinkPageIds,
        async (navigationLinkPageId) =>
          notion.getPage(navigationLinkPageId, {
            chunkLimit: 1,
            fetchMissingBlocks: false,
            fetchCollections: false,
            signFileUrls: false
          }),
        {
          concurrency: 4
        }
      )
    }

    return []
  }
)

const cacheTTL = 24*60*60*1000; //1 day

export async function getPage(pageId: string): Promise<ExtendedRecordMap> {
  const cacheKey = `page-records:${pageId}`;
  let record;
  try {
    // check if the database has a cached mapping of this URI to page ID
    const recordString  = await db.get(cacheKey);
    record = recordString !== '' ? JSON.parse(recordString) : null;
    if (record === null) {
      throw new Error('Cache Miss')
    }
    console.log(`cacheHit: ${pageId} : ${cacheKey}`);
    console.log(recordString)

    // console.log(`redis get "${cacheKey}"`, pageId)
  } catch (err) {
    // ignore redis errors
    console.warn(`redis error get "${cacheKey}"`, err.message)

    record = await getPageFromApi(pageId);

    await db.set(cacheKey, JSON.stringify(record), cacheTTL)

  }
  return record;
}


export async function getPageFromApi(pageId: string): Promise<ExtendedRecordMap> {
  let recordMap = await notion.getPage(pageId)

  if (navigationStyle !== 'default') {
    // ensure that any pages linked to in the custom navigation header have
    // their block info fully resolved in the page record map so we know
    // the page title, slug, etc.
    const navigationLinkRecordMaps = await getNavigationLinkPages()

    if (navigationLinkRecordMaps?.length) {
      recordMap = navigationLinkRecordMaps.reduce(
        (map, navigationLinkRecordMap) =>
          mergeRecordMaps(map, navigationLinkRecordMap),
        recordMap
      )
    }
  }

  if (isPreviewImageSupportEnabled) {
    const previewImageMap = await getPreviewImageMap(recordMap)
    ;(recordMap as any).preview_images = previewImageMap
  }

  return recordMap
}

export async function search(params: SearchParams): Promise<SearchResults> {
  return notion.search(params)
}
