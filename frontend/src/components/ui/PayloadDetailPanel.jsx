import React, { useState, useEffect, useRef } from 'react';
import {
  CloudDownload,
  Loader2,
  ArrowLeft,
  ArrowUpCircle,
  CheckCircle2,
  CircleUser,
  ExternalLink,
  FileText,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { parseMarkdown } from '../../utils/markdown';
import { useTranslation } from 'react-i18next';
import PayloadIcon from './PayloadIcon';

const GithubIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
);

const getRepoUrl = (p) => {
  if (!p) return null;
  if (p.repository) return p.repository;
  if (p.repo_url) return p.repo_url;
  if (p.source) {
    return p.source.replace(/\/releases(\/.*)?$/, '');
  }
  return null;
};

const getReadmeUrls = (payload, srcUrl) => {
  const urls = [];

  // 1. Explicit details_url
  if (payload?.details_url) {
    let url = payload.details_url;
    if (!url.startsWith('http') && srcUrl) {
      const base = srcUrl.substring(0, srcUrl.lastIndexOf('/') + 1);
      url = base + url;
    }
    urls.push(url);
  }

  // 2. GitHub repo README fallback
  const repo = getRepoUrl(payload);
  if (repo) {
    const match = repo.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i);
    if (match) {
      const owner = match[1];
      const repoName = match[2].replace(/\.git$/, '');
      urls.push(`https://raw.githubusercontent.com/${owner}/${repoName}/HEAD/README.md`);
      urls.push(`https://raw.githubusercontent.com/${owner}/${repoName}/main/README.md`);
      urls.push(`https://raw.githubusercontent.com/${owner}/${repoName}/master/README.md`);
    }
  }

  return urls;
};

const PayloadDetailPanel = ({ payload, onClose, onInstall, statusInfo, isInstalled, isUpdate, srcUrl, srcId }) => {
  const { t } = useTranslation();
  const [detailsHtml, setDetailsHtml] = useState(null);
  const [detailsError, setDetailsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const detailsRef = useRef(null);

  const repoUrl = getRepoUrl(payload);

  useEffect(() => {
    const urls = getReadmeUrls(payload, srcUrl);
    if (urls.length === 0) {
      return;
    }

    let cancelled = false;
    const fetchDetails = async () => {
      setDetailsHtml(null);
      setDetailsError(false);
      setLoading(true);
      let foundText = null;

      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const text = await res.text();
            if (text && !text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
              foundText = text;
              break;
            }
          }
        } catch {
          /* try next candidate */
        }
      }

      if (cancelled) return;

      if (foundText) {
        const cleanHtml = parseMarkdown(foundText);
        setDetailsHtml(cleanHtml);
      } else {
        setDetailsError(true);
      }
      setLoading(false);
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [payload, srcUrl]);

  if (!payload) return null;

  return (
    <div className="flex flex-col w-full min-h-full animate-in fade-in duration-300 pb-16">
      {/* Back button */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center space-x-2.5 text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl border border-white/5 hover:border-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-bold text-sm uppercase tracking-wider">
            {t("storage_hub.back_to_repository", "Back to Repository")}
          </span>
        </button>
      </div>

      {/* Hero Header Card */}
      <div className="glass-card p-6 md:p-8 rounded-3xl border border-white/10 flex flex-col md:flex-row items-start gap-6 relative">
        {/* Left: Big Icon */}
        <div className="shrink-0 self-start">
          <PayloadIcon
            icon={payload.icon}
            name={payload.filename}
            className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 text-3xl sm:text-4xl shadow-2xl"
          />
        </div>

        {/* Center: Details & Metadata */}
        <div className="flex-1 min-w-0 flex flex-col justify-start gap-3 w-full">
          {/* Title + Version pill */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight break-words">
              {payload.name || payload.filename}
            </h1>
            {payload.version && (
              <span className="px-2.5 py-1 rounded-lg bg-ps-blue/15 text-ps-blue border border-ps-blue/30 font-extrabold text-xs sm:text-sm tracking-wider uppercase shrink-0">
                {payload.version.startsWith('v') ? payload.version : `v${payload.version}`}
              </span>
            )}
            {payload.category && (
              <span className="px-2.5 py-1 rounded-lg bg-white/5 text-zinc-400 border border-white/10 font-bold text-xs uppercase tracking-wider shrink-0">
                {t(`category.${payload.category}`, payload.category)}
              </span>
            )}
          </div>

          {/* Author & Repository Metadata */}
          <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs sm:text-sm text-zinc-400">
            {payload.author && (
              <div className="flex items-center gap-1.5 shrink-0">
                <CircleUser className="w-4 h-4 text-zinc-400 shrink-0" />
                <span>
                  {t("storage_hub.by_author", "by {{author}}", { author: payload.author })}
                </span>
              </div>
            )}
            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-ps-blue hover:text-white transition-colors underline-offset-2 hover:underline shrink-0"
                title={repoUrl}
              >
                <GithubIcon className="w-4 h-4 shrink-0" />
                <span className="truncate max-w-[240px] sm:max-w-[320px]">
                  {repoUrl.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')}
                </span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
              </a>
            )}
            {payload.filename && (
              <span className="font-mono text-zinc-500 text-xs truncate max-w-[220px]" title={payload.filename}>
                {payload.filename}
              </span>
            )}
          </div>

          {/* Short description */}
          {payload.description && (
            <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-3xl pt-1">
              {payload.description}
            </p>
          )}
          {statusInfo?.alsoInstalledFrom && (
            <p className="text-xs sm:text-sm text-amber-400/90 font-medium pt-1">
              {t("storage_hub.also_installed_hint", "Also installed from {{source}}", { source: statusInfo.alsoInstalledFrom })}
            </p>
          )}
        </div>

        {/* Action Button: Compact, nicely proportioned */}
        <div className="shrink-0 w-full sm:w-auto md:self-start pt-1">
          {(() => {
            const buttonAction = statusInfo ? statusInfo.buttonAction : (isUpdate ? 'update' : (isInstalled ? 'reinstall' : 'install'));

            if (buttonAction === 'update') {
              return (
                <button
                  type="button"
                  onClick={() => onInstall(payload, srcId, srcUrl, statusInfo)}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 px-7 py-3.5 rounded-2xl font-extrabold text-base transition-all active:scale-95 shadow-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40"
                >
                  <ArrowUpCircle className="w-5 h-5 shrink-0" />
                  <span>{t("payload_detail.update", "Update")}</span>
                </button>
              );
            }

            if (buttonAction === 'reinstall') {
              return (
                <button
                  type="button"
                  onClick={() => onInstall(payload, srcId, srcUrl, statusInfo)}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 px-7 py-3.5 rounded-2xl font-extrabold text-base transition-all active:scale-95 shadow-lg bg-white/10 hover:bg-white/20 text-white border border-white/20"
                >
                  <RefreshCw className="w-5 h-5 shrink-0" />
                  <span>{t("payload_detail.reinstall", "Reinstall")}</span>
                </button>
              );
            }

            if (buttonAction === 'install') {
              return (
                <button
                  type="button"
                  onClick={() => onInstall(payload, srcId, srcUrl, statusInfo)}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 px-7 py-3.5 rounded-2xl font-extrabold text-base transition-all active:scale-95 shadow-lg bg-ps-blue hover:bg-ps-blue/80 text-white shadow-ps-blue/20"
                >
                  <CloudDownload className="w-5 h-5 shrink-0" />
                  <span>{t("payload_detail.install", "Install")}</span>
                </button>
              );
            }

            // Older version in repo -> show Installed state, no action button
            return (
              <div className="w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 px-7 py-3.5 rounded-2xl font-extrabold text-base bg-white/5 text-zinc-400 border border-white/10">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                <span>{t("payload_detail.installed", "Installed")}</span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Release Notes / What's New */}
      {payload.release_notes && (
        <div className="mt-8 space-y-3">
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-ps-blue" />
            <span>{t("payload_detail.whats_new", "What's New")}</span>
          </h3>
          <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-white/5 bg-black/20">
            <div
              className="markdown-body text-sm"
              dangerouslySetInnerHTML={{ __html: parseMarkdown(payload.release_notes) }}
            />
          </div>
        </div>
      )}

      {/* Full Description / README Section */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-ps-blue" />
            <span>{t("payload_detail.readme_title", "README")}</span>
          </h3>
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-400 hover:text-ps-blue flex items-center gap-1.5 transition-colors"
            >
              <span>{t("payload_detail.view_on_github", "View on GitHub")}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {loading ? (
          <div className="py-16 glass-panel rounded-2xl border border-white/5 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-ps-blue animate-spin" />
            <p className="text-zinc-400 text-sm">
              {t("payload_detail.loading_details", "Loading README...")}
            </p>
          </div>
        ) : detailsHtml ? (
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-white/5 bg-black/20">
            <div
              ref={detailsRef}
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: detailsHtml }}
            />
          </div>
        ) : detailsError ? (
          <div className="py-12 glass-panel rounded-2xl border border-white/5 text-center text-zinc-500">
            <p className="text-sm">
              {t("payload_detail.no_readme", "No README available for this payload.")}
            </p>
          </div>
        ) : (
          <div className="py-12 glass-panel rounded-2xl border border-white/5 text-center text-zinc-500">
            <p className="text-sm">
              {t("payload_detail.no_readme", "No README available for this payload.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayloadDetailPanel;
