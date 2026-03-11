import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RulesPage } from "./components/RulesPage";
import { ConfigPage } from "./components/ConfigPage";
import { PromptEditor } from "./components/PromptEditor";
import { ReviewHistory } from "./components/ReviewHistory";
import { ReviewDetail } from "./components/ReviewDetail";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/rules" replace />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/prompt" element={<PromptEditor />} />
          <Route path="/reviews" element={<ReviewHistory />} />
          <Route path="/reviews/:id" element={<ReviewDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
