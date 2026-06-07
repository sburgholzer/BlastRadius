"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = require("fs");
const path_1 = require("path");
const app = (0, express_1.default)();
const PORT = 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Load all data files from the data/ directory
const dataDir = (0, path_1.join)(__dirname, 'data');
const dataFiles = (0, fs_1.readdirSync)(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
    name: f.replace('.json', ''),
    data: JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(dataDir, f), 'utf-8')),
}));
let requestCounter = 0;
// GET /api/analyses — list all analyses (for the frontend list page)
app.get('/api/analyses', (_req, res) => {
    res.json(dataFiles.map((f, i) => ({
        analysisId: `demo-${f.name}`,
        requestingPrincipal: 'arn:aws:iam::123456789012:user/demo-user',
        originatingAccountId: '123456789012',
        status: 'completed',
        currentStage: 'Complete',
        progressPercentage: 100,
        elapsedTimeMs: 4200 + i * 1000,
        startedAt: new Date(Date.now() - (3 - i) * 3600000).toISOString(),
        updatedAt: new Date(Date.now() - (3 - i) * 3600000 + 4200).toISOString(),
    })));
});
// GET /api/formats — supported input formats
app.get('/api/formats', (_req, res) => {
    res.json({
        formats: [
            { id: 'terraform', name: 'Terraform Plan JSON', extension: '.json' },
            { id: 'cdk', name: 'CDK CloudFormation Diff', extension: '.json' },
            { id: 'cloudformation', name: 'CloudFormation Changeset', extension: '.json' },
        ],
    });
});
// POST /api/analyze — submit a new analysis (returns immediately with a fake ID)
app.post('/api/analyze', (_req, res) => {
    const scenarioIndex = requestCounter % dataFiles.length;
    const analysisId = `analysis-${Date.now()}-${dataFiles[scenarioIndex].name}`;
    res.status(201).json({
        analysisId,
        status: 'completed',
        message: `Analysis complete. Using scenario: ${dataFiles[scenarioIndex].name}`,
    });
});
// GET /api/analyze/:id — retrieve analysis results
app.get('/api/analyze/:id', (req, res) => {
    const { id } = req.params;
    const { scenario } = req.query;
    function buildResponse(analysisId, fileData) {
        return {
            analysisId,
            status: 'completed',
            requestingPrincipal: 'arn:aws:iam::123456789012:user/demo-user',
            originatingAccountId: '123456789012',
            sourceFormat: fileData.metadata?.sourceFormat ?? 'terraform',
            submittedAt: new Date(Date.now() - 60000).toISOString(),
            completedAt: new Date().toISOString(),
            naturalLanguageSummary: fileData.summary,
            dependencyGraph: fileData.dependencyGraph,
            scoredResources: fileData.scoredResources,
            riskSummary: fileData.riskSummary,
            stageDurations: { Ingestion: 200, Discovery: 2500, Scoring: 800, VisualizationPrep: 400 },
            completedStages: ['Ingestion', 'Discovery', 'Scoring', 'VisualizationPrep'],
        };
    }
    // If a specific scenario is requested via query param, use it
    if (scenario && typeof scenario === 'string') {
        const match = dataFiles.find((f) => f.name === scenario);
        if (match) {
            return res.json(buildResponse(id, match.data));
        }
        return res.status(404).json({ error: `Scenario '${scenario}' not found` });
    }
    // Otherwise, pick based on the ID or cycle through scenarios
    const scenarioFromId = dataFiles.find((f) => id.includes(f.name));
    if (scenarioFromId) {
        return res.json(buildResponse(id, scenarioFromId.data));
    }
    // Default: cycle through available scenarios
    const cycleIndex = requestCounter++ % dataFiles.length;
    res.json(buildResponse(id, dataFiles[cycleIndex].data));
});
// GET /api/scenarios — list available demo scenarios
app.get('/api/scenarios', (_req, res) => {
    res.json({
        scenarios: dataFiles.map((f) => ({
            id: f.name,
            description: f.data.summary || f.name,
            riskSummary: f.data.riskSummary,
        })),
    });
});
app.listen(PORT, () => {
    console.log(`\n🔥 Blast Radius Demo Server running on http://localhost:${PORT}`);
    console.log(`\nAvailable endpoints:`);
    console.log(`  GET  http://localhost:${PORT}/api/formats`);
    console.log(`  POST http://localhost:${PORT}/api/analyze`);
    console.log(`  GET  http://localhost:${PORT}/api/analyze/:id`);
    console.log(`  GET  http://localhost:${PORT}/api/analyze/:id?scenario=security-group-change`);
    console.log(`  GET  http://localhost:${PORT}/api/scenarios`);
    console.log(`\nLoaded ${dataFiles.length} scenarios: ${dataFiles.map((f) => f.name).join(', ')}`);
});
//# sourceMappingURL=server.js.map