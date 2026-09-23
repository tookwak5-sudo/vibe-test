import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/ko'

dayjs.extend(relativeTime)
dayjs.locale('ko')

const API = 'http://localhost:8080/api/v1/station'
const EMPTY_FORM = { stationName: '', subwayLine: '', location: '' }
const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
const readSaved = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
const readMapPoints = () => { try { const value = JSON.parse(localStorage.getItem('station-map-points') || '{}'); return value && !Array.isArray(value) && typeof value === 'object' ? value : {} } catch { return {} } }
const readLineColors = () => { try { const value = JSON.parse(localStorage.getItem('station-line-colors') || '{}'); return value && !Array.isArray(value) && typeof value === 'object' ? value : {} } catch { return {} } }
const routeColor = (line = '') => {
  const colors = ['#2879a8', '#d45d57', '#57966c', '#8b65b0', '#d28a32', '#4970bf', '#c25c8c']
  return colors[[...line].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length]
}
const stationLines = (station) => [...new Set(String(station.subwayLine || '').split(/[，,]/).map((line) => line.trim()).filter(Boolean))]

function searchForm(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase('ko').replace(/[\uAC00-\uD7A3]/g, (s) => {
    const code = s.charCodeAt(0) - 0xAC00
    return CHOSEONG[Math.floor(code / 588)] + String.fromCharCode(0x314F + Math.floor((code % 588) / 28)) + (code % 28 ? String.fromCharCode(0x11A7 + code % 28) : '')
  }).replace(/[\u3131-\u314E\u314F-\u3163]/g, (j) => j)
}

function matches(field, query) {
  if (!query.trim()) return true
  const target = searchForm(field)
  const needle = searchForm(query.trim())
  if (target.includes(needle)) return true
  // Permit an incomplete final consonant: 엯 can still locate 역삼.
  const withoutFinals = (value) => value.replace(/[\u11A8-\u11C2]/g, '')
  return withoutFinals(target).includes(withoutFinals(needle))
}

function dateLabel(value) {
  if (!value) return '—'
  const date = dayjs(value)
  return date.isValid() ? <>{date.format('YYYY.MM.DD HH:mm')} <span className="relative-time">({date.fromNow()})</span></> : '—'
}

function App() {
  const [stations, setStations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [notice, setNotice] = useState(null)
  const [filters, setFilters] = useState({ name: '', line: '', location: '' })
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [detail, setDetail] = useState(null)
  const [favorites, setFavorites] = useState(() => readSaved('station-favorites'))
  const [recent, setRecent] = useState(() => readSaved('station-recent'))
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [missingOnly, setMissingOnly] = useState(false)
  const [view, setView] = useState('cards')
  const [errors, setErrors] = useState({})
  const [copied, setCopied] = useState(false)
  const [mapPoints, setMapPoints] = useState(readMapPoints)
  const [lineColors, setLineColors] = useState(readLineColors)
  const [placementTarget, setPlacementTarget] = useState(null)
  const [mapSelection, setMapSelection] = useState(null)
  const [dragStation, setDragStation] = useState(null)
  const dragMoved = useRef(false)

  useEffect(() => { localStorage.setItem('station-favorites', JSON.stringify(favorites)) }, [favorites])
  useEffect(() => { localStorage.setItem('station-recent', JSON.stringify(recent)) }, [recent])
  useEffect(() => { localStorage.setItem('station-map-points', JSON.stringify(mapPoints)) }, [mapPoints])
  useEffect(() => { localStorage.setItem('station-line-colors', JSON.stringify(lineColors)) }, [lineColors])

  const loadStations = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    try {
      const response = await fetch(`${API}/`)
      if (!response.ok) throw new Error(`목록을 불러오지 못했습니다. (${response.status})`)
      const data = await response.json()
      setStations(Array.isArray(data) ? data : [])
    } catch (error) {
      setNotice({ variant: 'danger', message: error.message || '서버에 연결하지 못했습니다.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadStations(true) }, [loadStations])

  const filtered = useMemo(() => stations.filter((station) =>
    matches(station.stationName, filters.name) && matches(station.subwayLine, filters.line) && matches(station.location || '', filters.location)
      && (!favoritesOnly || favorites.includes(station.stationNo)) && (!missingOnly || !station.location?.trim())), [stations, filters, favoritesOnly, missingOnly, favorites])

  const lineCounts = useMemo(() => stations.reduce((counts, station) => {
    for (const line of stationLines(station)) counts[line] = (counts[line] || 0) + 1
    return counts
  }, {}), [stations])
  const stationGroups = useMemo(() => {
    const groups = stations.reduce((result, station) => {
      for (const line of stationLines(station)) result[line] = [...(result[line] || []), station]
      return result
    }, {})
    Object.values(groups).forEach((group) => group.sort((a, b) => Number(a.stationNo) - Number(b.stationNo)))
    return groups
  }, [stations])
  const automaticPoints = useMemo(() => {
    const lines = Object.entries(stationGroups)
    const defaults = {}
    lines.forEach(([, group], lineIndex) => group.forEach((station, stationIndex) => {
      if (!defaults[station.stationNo]) defaults[station.stationNo] = {
        x: 8 + ((stationIndex + 1) / (group.length + 1)) * 84,
        y: 12 + ((lineIndex + 1) / (lines.length + 1)) * 76,
      }
    }))
    return Object.fromEntries(stations.map((station) => [station.stationNo, mapPoints[station.stationNo] || defaults[station.stationNo] || { x: 50, y: 50 }]))
  }, [stations, stationGroups, mapPoints])
  const getLineColor = (line) => lineColors[line] || routeColor(line)
  const activeFilters = [filters.name && ['역명', filters.name, 'name'], filters.line && ['노선', filters.line, 'line'], filters.location && ['위치', filters.location, 'location'], favoritesOnly && ['즐겨찾기', '만', 'favorite'], missingOnly && ['위치 누락', '만', 'missing']].filter(Boolean)

  function openDetail(station) {
    setDetail(station)
    setMapSelection(station.stationNo)
    setRecent((current) => [station.stationNo, ...current.filter((id) => id !== station.stationNo)].slice(0, 6))
  }
  function showOnMap(station) {
    setDetail(null)
    setView('map')
    setMapSelection(station.stationNo)
    setPlacementTarget(null)
  }
  function handleMapClick(event) {
    if (placementTarget === null) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(1, Math.min(99, ((event.clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(1, Math.min(99, ((event.clientY - bounds.top) / bounds.height) * 100))
    setMapPoints((current) => ({ ...current, [placementTarget]: { x, y } }))
    setMapSelection(placementTarget)
    setPlacementTarget(null)
    setNotice({ variant: 'success', message: '역의 노선도 위치를 저장했습니다.' })
  }
  function updateDraggedPoint(event) {
    if (dragStation === null) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(1, Math.min(99, ((event.clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(1, Math.min(99, ((event.clientY - bounds.top) / bounds.height) * 100))
    setMapPoints((current) => ({ ...current, [dragStation]: { x, y } }))
    dragMoved.current = true
  }
  function resetLineLayout(line) {
    const ids = new Set((stationGroups[line] || []).map((station) => String(station.stationNo)))
    setMapPoints((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id))))
  }
  function startPlacement(stationNo) {
    setDetail(null)
    setView('map')
    setMapSelection(stationNo)
    setPlacementTarget(stationNo)
  }
  function toggleFavorite(stationNo) {
    setFavorites((current) => current.includes(stationNo) ? current.filter((id) => id !== stationNo) : [stationNo, ...current])
  }
  function clearFilter(key) {
    if (key === 'favorite') setFavoritesOnly(false)
    else if (key === 'missing') setMissingOnly(false)
    else setFilters((current) => ({ ...current, [key]: '' }))
  }

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setErrors({}); setShowForm(true) }
  function openEdit(station) {
    setDetail(null); setEditing(station); setErrors({})
    setForm({ stationName: station.stationName || '', subwayLine: station.subwayLine || '', location: station.location || '' })
    setShowForm(true)
  }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    const nextErrors = { stationName: !form.stationName.trim() ? '역명을 입력해 주세요.' : '', subwayLine: !form.subwayLine.trim() ? '노선을 입력해 주세요.' : '' }
    setErrors(nextErrors)
    if (nextErrors.stationName || nextErrors.subwayLine) return
    setSaving(true)
    const isEdit = Boolean(editing)
    const stationName = form.stationName.trim()
    try {
      const response = await fetch(isEdit ? `${API}/${editing.stationNo}` : `${API}/`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { stationNo: editing.stationNo, ...form } : form),
      })
      if (!response.ok) throw new Error(`저장에 실패했습니다. (${response.status})`)
      setShowForm(false); setForm(EMPTY_FORM)
      setNotice({ variant: 'success', message: `${stationName} 역 ${isEdit ? '정보를 수정했습니다.' : '등록을 완료했습니다.'}` })
      await loadStations()
    } catch (error) { setNotice({ variant: 'danger', message: `${stationName || '역'} ${isEdit ? '수정' : '등록'} 실패: ${error.message || '서버 오류'}` }) }
    finally { setSaving(false) }
  }

  async function removeStation(station) {
    if (deleting !== null) return
    if (!window.confirm(`'${station.stationName}' 역을 삭제할까요?`)) return
    setDeleting(station.stationNo)
    try {
      const response = await fetch(`${API}/${station.stationNo}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`삭제에 실패했습니다. (${response.status})`)
      setDetail(null)
      setMapPoints((current) => { const next = { ...current }; delete next[station.stationNo]; return next })
      setFavorites((current) => current.filter((id) => id !== station.stationNo))
      setRecent((current) => current.filter((id) => id !== station.stationNo))
      setNotice({ variant: 'success', message: `${station.stationName} 역이 삭제되었습니다.` })
      await loadStations()
    } catch (error) { setNotice({ variant: 'danger', message: `${station.stationName} 역 삭제 실패: ${error.message || '서버 오류'}` }) }
    finally { setDeleting(null) }
  }

  return (
    <main className="app-shell">
      <header className="topbar"><div className="topbar-inner"><a className="brand" href="#top"><span className="brand-mark">S</span><span>STATION<span className="brand-light"> / MANAGER</span></span></a><span className="topbar-label">운영 도구</span></div></header>
      <div className="page-wrap" id="top">
        <div className="page-heading"><div><div className="eyebrow">TRANSIT DIRECTORY</div><h1>역 정보 관리</h1><p className="page-subtitle">역 정보를 한곳에서 확인하고 관리하세요.</p></div><Button className="create-button" onClick={openCreate}><span className="plus">＋</span> 역 등록</Button></div>

        {notice && <Alert variant={notice.variant} dismissible onClose={() => setNotice(null)} className="notice"><span className="notice-dot" />{notice.message}</Alert>}

        {!loading && <section className="line-overview"><div className="section-kicker">NETWORK OVERVIEW</div><div className="line-chips">{Object.entries(lineCounts).map(([line, count]) => <button key={line} className="line-chip" onClick={() => setFilters((current) => ({ ...current, line }))}><i style={{ background: getLineColor(line) }} />{line}<b>{count}</b></button>)}</div></section>}

        {recent.length > 0 && <section className="recent-strip"><span className="section-kicker">최근 본 역</span><div className="recent-links">{recent.map((id) => stations.find((station) => station.stationNo === id)).filter(Boolean).map((station) => <button key={station.stationNo} onClick={() => openDetail(station)}>{station.stationName}<span>↗</span></button>)}</div></section>}

        <section className="filter-panel" aria-label="역 검색">
          <div className="filter-topline"><div><div className="section-kicker">QUICK SEARCH</div><h2>어떤 역을 찾으세요?</h2></div><span className="filter-hint">입력과 동시에 결과가 좁혀집니다</span></div>
          <div className="filter-grid">
            <Form.Group><Form.Label>역명</Form.Label><Form.Control value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && filtered[0] && openDetail(filtered[0])} placeholder="예: 강남역, ㄱㄴ" /></Form.Group>
            <Form.Group><Form.Label>노선</Form.Label><Form.Control value={filters.line} onChange={(e) => setFilters({ ...filters, line: e.target.value })} placeholder="예: 2호선" /></Form.Group>
            <Form.Group><Form.Label>위치</Form.Label><Form.Control value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} placeholder="지역 또는 주소" /></Form.Group>
            <Button variant="link" className="clear-button" onClick={() => setFilters({ name: '', line: '', location: '' })}>초기화</Button>
          </div>
          <div className="filter-toggles"><Button variant={favoritesOnly ? 'primary' : 'outline-secondary'} size="sm" onClick={() => setFavoritesOnly(!favoritesOnly)}>☆ 즐겨찾기 {favoritesOnly ? '표시 중' : '보기'}</Button><Button variant={missingOnly ? 'primary' : 'outline-secondary'} size="sm" onClick={() => setMissingOnly(!missingOnly)}>위치 누락 {missingOnly ? '표시 중' : '보기'}</Button></div>
          {activeFilters.length > 0 && <div className="active-filters"><span>적용 중</span>{activeFilters.map(([label, value, key]) => <button key={key} onClick={() => clearFilter(key)}>{label}: {value} <b>×</b></button>)}<button className="clear-all" onClick={() => { setFilters({ name: '', line: '', location: '' }); setFavoritesOnly(false); setMissingOnly(false) }}>모두 지우기</button></div>}
          <div className="filter-summary"><span>검색 결과</span><strong>{filtered.length}</strong><span>개 역</span></div>
        </section>

        <section className="results-section">
          <div className="results-heading"><div><div className="section-kicker">STATION LIST</div><h2>{favoritesOnly ? '즐겨찾기 역' : missingOnly ? '위치 확인이 필요한 역' : view === 'map' ? '노선도 보기' : '전체 역'} <span className="count-pill">{filtered.length}</span></h2></div><div className="view-switch"><Button size="sm" variant={view === 'cards' ? 'primary' : 'light'} onClick={() => setView('cards')}>카드</Button><Button size="sm" variant={view === 'list' ? 'primary' : 'light'} onClick={() => setView('list')}>목록</Button><Button size="sm" variant={view === 'map' ? 'primary' : 'light'} onClick={() => setView('map')}>노선도</Button></div></div>
          {view === 'map' && !loading && <section className="map-panel">
            <div className="map-toolbar"><div><strong>역 위치 노선도</strong><span>노선별 역번호순 자동 배치 · 마커를 드래그해 조정하거나 클릭해 상세를 보세요.</span></div><Badge bg="light" text="secondary">수동 조정 전 {stations.filter((station) => !mapPoints[station.stationNo]).length}</Badge></div>
            <div className={`schematic-map ${placementTarget !== null ? 'is-placing' : ''}`}>
              <svg viewBox="0 0 1000 600" preserveAspectRatio="none" className="map-svg" aria-label="역 위치를 표시하는 개략 노선도" onClick={handleMapClick} onPointerMove={updateDraggedPoint} onPointerUp={() => setDragStation(null)} onPointerCancel={() => setDragStation(null)}>
                <defs><pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e9edf2" strokeWidth="1" /></pattern></defs>
                <rect width="1000" height="600" fill="url(#map-grid)" />
                {Object.entries(stationGroups).map(([line, group]) => <polyline key={line} points={group.map((station) => `${automaticPoints[station.stationNo].x * 10},${automaticPoints[station.stationNo].y * 6}`).join(' ')} fill="none" stroke={getLineColor(line)} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity={filters.line ? (line === filters.line ? 0.86 : 0.15) : 0.58} />)}
                {stations.map((station) => {
                  const point = automaticPoints[station.stationNo]
                  const isVisible = filtered.some((item) => item.stationNo === station.stationNo)
                  const active = mapSelection === station.stationNo
                  return <g key={station.stationNo} className={`map-marker ${active ? 'active' : ''} ${isVisible ? '' : 'dimmed'} ${dragStation === station.stationNo ? 'dragging' : ''}`} transform={`translate(${point.x * 10},${point.y * 6})`} role="button" tabIndex="0" aria-label={`${station.stationName}, ${station.subwayLine}, 역 번호 ${station.stationNo}. 드래그해 위치 조정`} onPointerDown={(event) => { if (placementTarget !== null) return; event.preventDefault(); event.stopPropagation(); dragMoved.current = false; setDragStation(station.stationNo); event.currentTarget.setPointerCapture(event.pointerId) }} onClick={(event) => { if (placementTarget !== null) return; event.stopPropagation(); if (dragMoved.current) { dragMoved.current = false; return } openDetail(station) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(station) } }}>
                    {active && <circle r="28" className="marker-halo" />}<circle r="15" fill="white" stroke={getLineColor(station.subwayLine)} strokeWidth="6" /><text y="-24" textAnchor="middle">{station.stationName}</text><text y="28" textAnchor="middle" className="station-id-label">#{station.stationNo}</text>
                  </g>
                })}
              </svg>
              {placementTarget !== null && <div className="placement-tip">지도를 눌러 {stations.find((station) => station.stationNo === placementTarget)?.stationName} 위치를 지정하세요 <Button size="sm" variant="light" onClick={() => setPlacementTarget(null)}>취소</Button></div>}
            </div>
            <div className="map-legend">{Object.keys(lineCounts).map((line) => <div className="map-line-setting" key={line}><button onClick={() => setFilters((current) => ({ ...current, line: current.line === line ? '' : line }))}><i style={{ background: getLineColor(line) }} />{line} · 역번호순</button><Form.Control aria-label={`${line} 색상`} type="color" value={getLineColor(line)} onChange={(event) => setLineColors((current) => ({ ...current, [line]: event.target.value }))} /><Button size="sm" variant="link" onClick={() => setLineColors((current) => { const next = { ...current }; delete next[line]; return next })}>기본색</Button><Button size="sm" variant="link" onClick={() => resetLineLayout(line)}>자동 정렬</Button></div>)}</div>
            <div className="map-unplaced"><div><strong>자동 배치 역</strong><span> {stations.filter((station) => !mapPoints[station.stationNo]).length}개 · 직접 지정하려면 역을 선택한 뒤 노선도를 누르세요</span></div><div className="unplaced-list">{stations.filter((station) => !mapPoints[station.stationNo]).map((station) => <Button key={station.stationNo} size="sm" variant={placementTarget === station.stationNo ? 'primary' : 'outline-secondary'} onClick={() => startPlacement(station.stationNo)}>{station.stationName} · {station.subwayLine}</Button>)}</div></div>
            <p className="map-disclaimer">개략 노선도입니다. 배경은 지리적 위치와 비례하지 않으며, 역 마커는 직접 지정한 위치입니다.</p>
          </section>}
          {view !== 'map' && (loading ? <div className="state-box"><Spinner animation="border" size="sm" /> <span>역 목록을 불러오는 중입니다</span></div> : filtered.length === 0 ? <div className="state-box empty-state"><span className="empty-symbol">⌕</span><strong>{stations.length ? '조건에 맞는 역이 없습니다' : '등록된 역이 없습니다'}</strong><span>{activeFilters.length ? `적용된 조건: ${activeFilters.map(([label, value]) => `${label} ${value}`).join(' · ')}` : '첫 역 정보를 등록해 보세요.'}</span>{stations.length ? <Button variant="outline-primary" onClick={() => { setFilters({ name: '', line: '', location: '' }); setFavoritesOnly(false); setMissingOnly(false) }}>검색 조건 초기화</Button> : <Button variant="outline-primary" onClick={openCreate}>역 등록하기</Button>}</div> : <div className={view === 'cards' ? 'station-grid' : 'station-list'}>{filtered.map((station) => <article key={station.stationNo} className={view === 'cards' ? 'station-card' : 'station-row'}>
            <div className="station-card-top"><span className="station-number">NO. {station.stationNo}</span><div className="route-and-star"><Badge className="line-badge" style={{ '--route-color': getLineColor(stationLines(station)[0] || station.subwayLine) }}>{station.subwayLine}</Badge><button className={`favorite-button ${favorites.includes(station.stationNo) ? 'is-favorite' : ''}`} aria-label="즐겨찾기 전환" onClick={(event) => { event.stopPropagation(); toggleFavorite(station.stationNo) }}>{favorites.includes(station.stationNo) ? '★' : '☆'}</button></div></div>
            <h3>{station.stationName}</h3><div className="station-location">{station.location?.trim() ? '위치 정보 등록됨' : <span className="missing-label">위치 정보 필요</span>}</div>
            <div className="card-footer"><Button variant="link" className="card-detail-link" onClick={() => openDetail(station)}>상세 보기 <span className="arrow">↗</span></Button><div className="quick-actions"><Button variant="link" onClick={() => openEdit(station)}>수정</Button><span>·</span><Button variant="link" className="delete-link" disabled={deleting === station.stationNo} onClick={() => removeStation(station)}>{deleting === station.stationNo ? '삭제 중' : '삭제'}</Button></div></div>
          </article>)}</div>)}
        </section>
        <footer className="page-footer"><span>STATION DIRECTORY</span><span>역 정보를 편리하게 관리하세요.</span></footer>
      </div>

      <Modal show={showForm} onHide={() => !saving && setShowForm(false)} centered className="station-modal">
        <Form onSubmit={save}><Modal.Header closeButton><div><div className="section-kicker">STATION DETAILS</div><Modal.Title>{editing ? '역 정보 수정' : '새 역 등록'}</Modal.Title></div></Modal.Header><Modal.Body>
          {editing && <div className="readonly-number">역 번호 <strong>#{editing.stationNo}</strong></div>}
          <Form.Group className="mb-3"><Form.Label>역명 <span className="required">*</span></Form.Label><Form.Control maxLength={90} autoFocus isInvalid={Boolean(errors.stationName)} value={form.stationName} onChange={(e) => { setForm({ ...form, stationName: e.target.value }); setErrors({ ...errors, stationName: '' }) }} placeholder="역 이름을 입력하세요" /><Form.Control.Feedback type="invalid">{errors.stationName}</Form.Control.Feedback></Form.Group>
          <Form.Group className="mb-3"><Form.Label>노선 <span className="required">*</span></Form.Label><Form.Control maxLength={90} isInvalid={Boolean(errors.subwayLine)} value={form.subwayLine} onChange={(e) => { setForm({ ...form, subwayLine: e.target.value }); setErrors({ ...errors, subwayLine: '' }) }} placeholder="예: 2호선" /><Form.Control.Feedback type="invalid">{errors.subwayLine}</Form.Control.Feedback></Form.Group>
          <Form.Group><Form.Label>위치</Form.Label><Form.Control maxLength={255} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="주소 또는 지역을 입력하세요" /></Form.Group>
        </Modal.Body><Modal.Footer><Button variant="light" onClick={() => setShowForm(false)} disabled={saving}>취소</Button><Button type="submit" className="create-button" disabled={saving}>{saving && <Spinner size="sm" className="me-2" />}{saving ? '저장 중…' : editing ? '수정 완료' : '등록하기'}</Button></Modal.Footer></Form>
      </Modal>

      <Modal show={Boolean(detail)} onHide={() => setDetail(null)} centered className="station-modal detail-modal">
        {detail && <><Modal.Header closeButton><div><div className="section-kicker">STATION PROFILE</div><Modal.Title>역 상세 정보</Modal.Title></div></Modal.Header><Modal.Body><div className="detail-hero"><span className="station-number">NO. {detail.stationNo}</span><h2>{detail.stationName}</h2><Badge className="line-badge" style={{ '--route-color': getLineColor(stationLines(detail)[0] || detail.subwayLine) }}>{detail.subwayLine}</Badge></div><div className="detail-list"><div><span>위치</span><strong>{detail.location || '등록된 정보 없음'}</strong>{detail.location && <Button size="sm" variant="outline-secondary" onClick={async () => { try { await navigator.clipboard.writeText(detail.location); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { setNotice({ variant: 'danger', message: '위치를 복사하지 못했습니다.' }) } }}>{copied ? '복사됨' : '복사'}</Button>}</div><div><span>노선도 위치</span><strong>{mapPoints[detail.stationNo] ? `직접 조정 · X ${Math.round(mapPoints[detail.stationNo].x)}% · Y ${Math.round(mapPoints[detail.stationNo].y)}%` : '노선/역번호 기준 자동 배치'}</strong><Button size="sm" variant="outline-primary" onClick={() => showOnMap(detail)}>지도에서 보기</Button><Button size="sm" variant="outline-secondary" onClick={() => startPlacement(detail.stationNo)}>위치 수정</Button></div><div><span>생성일</span><strong>{dateLabel(detail.ctime)}</strong></div><div><span>수정일</span><strong>{dateLabel(detail.utime)}</strong></div></div></Modal.Body><Modal.Footer className="detail-actions"><Button variant="light" onClick={() => setDetail(null)}>닫기</Button><Button variant="outline-primary" onClick={() => openEdit(detail)}>수정</Button><Button variant="outline-danger" disabled={deleting === detail.stationNo} onClick={() => removeStation(detail)}>{deleting === detail.stationNo ? '삭제 중' : '삭제'}</Button></Modal.Footer></>}
      </Modal>
    </main>
  )
}

export default App
