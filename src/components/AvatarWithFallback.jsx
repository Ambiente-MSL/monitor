import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { dedupeNormalizedUrls } from "../lib/avatar";

export default function AvatarWithFallback({
  candidates = [],
  alt = "Avatar",
  imageClassName,
  placeholderClassName,
  placeholderText = "?",
  imageStyle,
  placeholderStyle,
}) {
  const normalizedCandidates = useMemo(
    () => dedupeNormalizedUrls(Array.isArray(candidates) ? candidates : [candidates]),
    [candidates],
  );
  const candidatesKey = useMemo(() => normalizedCandidates.join("|"), [normalizedCandidates]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidatesKey]);

  const src = normalizedCandidates[candidateIndex] || "";

  if (!src) {
    return (
      <span className={placeholderClassName} style={placeholderStyle}>
        {placeholderText}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={imageClassName}
      style={imageStyle}
      onError={() => setCandidateIndex((current) => current + 1)}
    />
  );
}

AvatarWithFallback.propTypes = {
  candidates: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.string), PropTypes.string]),
  alt: PropTypes.string,
  imageClassName: PropTypes.string,
  placeholderClassName: PropTypes.string,
  placeholderText: PropTypes.node,
  imageStyle: PropTypes.object,
  placeholderStyle: PropTypes.object,
};
