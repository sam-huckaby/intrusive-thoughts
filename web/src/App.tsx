import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RulesPage } from "./components/RulesPage";
import { ConfigPage } from "./components/ConfigPage";
import { ReviewHistory } from "./components/ReviewHistory";
import { ReviewDetail } from "./components/ReviewDetail";
import { ReviewersPage } from "./components/ReviewersPage";
import { ProfileEditor } from "./components/ProfileEditor";
import { ChangesPage } from "./components/ChangesPage";
import { EvalsPage } from "./components/EvalsPage";
import { EvalFixtureEditor } from "./components/EvalFixtureEditor";
import { EvalRunDetail } from "./components/EvalRunDetail";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/rules" replace />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/changes" element={<ChangesPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/prompt" element={<Navigate to="/reviewers" replace />} />
          <Route path="/reviewers" element={<ReviewersPage />} />
          <Route path="/reviewers/:id" element={<ProfileEditor />} />
          <Route path="/evals" element={<EvalsPage />} />
          <Route path="/evals/:id" element={<EvalFixtureEditor />} />
          <Route path="/evals/runs/:id" element={<EvalRunDetail />} />
          <Route path="/reviews" element={<ReviewHistory />} />
          <Route path="/reviews/:id" element={<ReviewDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
