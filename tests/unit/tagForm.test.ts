import { describe, expect, it } from 'vitest'
import {
  changesFrom,
  commonTags,
  EMPTY_FORM,
  hasChanges,
  type FormValues,
  type TagField
} from '@renderer/core/tagForm'

const touched = (...fields: TagField[]): Set<TagField> => new Set(fields)
const form = (over: Partial<FormValues> = {}): FormValues => ({ ...EMPTY_FORM, ...over })

describe('commonTags', () => {
  it('shows the shared value when every track agrees', () => {
    const { values, mixed } = commonTags([
      { title: 'A', artist: 'Band', year: 2001 },
      { title: 'A', artist: 'Band', year: 2001 }
    ])
    expect(values.title).toBe('A')
    expect(values.year).toBe('2001')
    expect(mixed.title).toBe(false)
  })

  /*
   * The field must NOT show one arbitrary track's value — a user glancing at
   * the form would read it as the answer for all twelve and save it over the
   * other eleven without ever meaning to.
   */
  it('marks a field mixed and shows nothing when tracks disagree', () => {
    const { values, mixed } = commonTags([{ title: 'A' }, { title: 'B' }])
    expect(mixed.title).toBe(true)
    expect(values.title).toBe('')
  })

  it('treats a shared album across differing titles correctly', () => {
    const { values, mixed } = commonTags([
      { title: 'One', album: 'Same' },
      { title: 'Two', album: 'Same' }
    ])
    expect(mixed.title).toBe(true)
    expect(mixed.album).toBe(false)
    expect(values.album).toBe('Same')
  })

  // 0 is how the reader reports "no year"; rendering it invites saving a zero.
  it('shows a zero year as empty rather than "0"', () => {
    expect(commonTags([{ year: 0 }, { year: 0 }]).values.year).toBe('')
  })

  it('handles a single track', () => {
    const { values, mixed } = commonTags([{ title: 'Solo', genre: 'Rock' }])
    expect(values.title).toBe('Solo')
    expect(Object.values(mixed).every((m) => !m)).toBe(true)
  })

  it('handles an empty selection without inventing values', () => {
    const { values, mixed } = commonTags([])
    expect(values).toEqual(EMPTY_FORM)
    expect(Object.values(mixed).some(Boolean)).toBe(false)
  })

  // A missing field and an empty one are the same thing to the user.
  it('treats absent and empty as agreeing', () => {
    expect(commonTags([{ genre: '' }, {}]).mixed.genre).toBe(false)
  })
})

describe('changesFrom', () => {
  /*
   * The rule that makes a twelve-track edit safe. Setting the album must not
   * also stamp the form's title onto every selected track.
   */
  it('omits every field the user did not touch', () => {
    const values = form({ title: 'Shown', album: 'New Album' })
    expect(changesFrom(values, touched('album'))).toEqual({ album: 'New Album' })
  })

  it('sends nothing when nothing was touched', () => {
    expect(changesFrom(form({ title: 'Shown' }), touched())).toEqual({})
  })

  // Deleting the text is how a wrong tag gets removed, so it must survive.
  it('keeps an emptied field as a deliberate clear', () => {
    expect(changesFrom(form({ genre: '' }), touched('genre'))).toEqual({ genre: '' })
  })

  it('parses numeric fields', () => {
    const values = form({ year: '1999', trackNo: '7', discNo: '2' })
    expect(changesFrom(values, touched('year', 'trackNo', 'discNo'))).toEqual({
      year: 1999,
      trackNo: 7,
      discNo: 2
    })
  })

  it('treats an emptied number as a clear', () => {
    expect(changesFrom(form({ year: '' }), touched('year'))).toEqual({ year: 0 })
  })

  /*
   * Dropping garbage rather than writing 0 matters: a user halfway through
   * retyping a year should not have it erased by what they typed en route.
   */
  it('drops unparseable numbers instead of writing a zero', () => {
    expect(changesFrom(form({ year: 'nineteen' }), touched('year'))).toEqual({})
    expect(changesFrom(form({ trackNo: '-3' }), touched('trackNo'))).toEqual({})
  })

  it('trims surrounding whitespace', () => {
    expect(changesFrom(form({ title: '  Padded  ' }), touched('title'))).toEqual({
      title: 'Padded'
    })
  })
})

describe('hasChanges', () => {
  it('is false until something is touched', () => {
    expect(hasChanges(form({ title: 'x' }), touched())).toBe(false)
  })

  it('is true once a field is edited', () => {
    expect(hasChanges(form({ title: 'x' }), touched('title'))).toBe(true)
  })

  it('is false when the only touched field holds garbage that gets dropped', () => {
    expect(hasChanges(form({ year: 'abc' }), touched('year'))).toBe(false)
  })
})
