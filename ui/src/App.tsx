import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './pages/Library'
import Analytics from './pages/Analytics'
import Hardware from './pages/Hardware'
import Vault from './pages/Vault'
import Settings from './pages/Settings'
import Search from './pages/Search'
import Versions from './pages/Versions'
import Engineers from './pages/Engineers'
import Janitor from './pages/Janitor'
import Playlists from './pages/Playlists'
import Polyphony from './pages/Polyphony'
import Codex from './pages/Codex'
import Cathode from './pages/Cathode'
import EQProfiles from './pages/EQProfiles'
import Dedup from './pages/Dedup'
import Sources from './pages/Sources'
import Completeness from './pages/Completeness'
import DAP from './pages/DAP'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Library />} />
          <Route path="search" element={<Search />} />
          <Route path="versions" element={<Versions />} />
          <Route path="engineers" element={<Engineers />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="hardware" element={<Hardware />} />
          <Route path="cathode" element={<Cathode />} />
          <Route path="eq-profiles" element={<EQProfiles />} />
          <Route path="dedup" element={<Dedup />} />
          <Route path="janitor" element={<Janitor />} />
          <Route path="polyphony" element={<Polyphony />} />
          <Route path="codex" element={<Codex />} />
          <Route path="vault" element={<Vault />} />
          <Route path="settings" element={<Settings />} />
          <Route path="sources" element={<Sources />} />
          <Route path="completeness" element={<Completeness />} />
          <Route path="dap" element={<DAP />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
