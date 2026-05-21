"use client";

import { useEffect, useRef, useState } from "react";

type AddressFieldNames = {
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal: string;
  country: string;
};

type AddressDefaults = Partial<Record<keyof AddressFieldNames, string | null>>;

type AddressAutocompleteFieldsProps = {
  names: AddressFieldNames;
  defaults?: AddressDefaults;
  labels?: Partial<Record<keyof AddressFieldNames, string>>;
  fieldClassName: string;
  labelClassName?: string;
  gridClassName?: string;
  required?: Partial<Record<keyof AddressFieldNames, boolean>>;
  maxLengths?: Partial<Record<keyof AddressFieldNames, number>>;
  countryCodeFormat?: "alpha2" | "alpha3";
  countryRestrictions?: string[];
};

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GooglePlaceResult = {
  address_components?: GoogleAddressComponent[];
};

type GoogleAutocomplete = {
  addListener(eventName: "place_changed", handler: () => void): { remove: () => void };
  getPlace(): GooglePlaceResult;
};

type GoogleAutocompleteConstructor = new (
  input: HTMLInputElement,
  options?: {
    componentRestrictions?: { country: string | string[] };
    fields?: string[];
    types?: string[];
  }
) => GoogleAutocomplete;

type GoogleMapsNamespace = {
  maps?: {
    places?: {
      Autocomplete?: GoogleAutocompleteConstructor;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
    googleMapsPlacesPromise?: Promise<void>;
  }
}

const defaultLabels = {
  line1: "Address line 1",
  line2: "Address line 2",
  city: "City",
  province: "Province",
  postal: "Postal code",
  country: "Country",
};

const alpha3Countries: Record<string, string> = {
  CA: "CAN",
  US: "USA",
};

function loadGoogleMapsPlaces(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places?.Autocomplete) return Promise.resolve();
  if (window.googleMapsPlacesPromise) return window.googleMapsPlacesPromise;

  window.googleMapsPlacesPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-places="true"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google Maps failed to load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsPlaces = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });

  return window.googleMapsPlacesPromise;
}

function getComponent(components: GoogleAddressComponent[], type: string, name: "long" | "short") {
  const component = components.find((item) => item.types.includes(type));
  return name === "long" ? component?.long_name ?? "" : component?.short_name ?? "";
}

function setInputValue(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) return;

  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function AddressAutocompleteFields({
  names,
  defaults,
  labels,
  fieldClassName,
  labelClassName = "block",
  gridClassName = "grid gap-4 md:grid-cols-2",
  required,
  maxLengths,
  countryCodeFormat = "alpha2",
  countryRestrictions = ["ca"],
}: AddressAutocompleteFieldsProps) {
  const line1Ref = useRef<HTMLInputElement>(null);
  const [autocompleteReady, setAutocompleteReady] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mergedLabels = { ...defaultLabels, ...labels };

  useEffect(() => {
    if (!apiKey) return;

    let isActive = true;
    loadGoogleMapsPlaces(apiKey)
      .then(() => {
        if (isActive) setAutocompleteReady(true);
      })
      .catch(() => {
        if (isActive) setAutocompleteReady(false);
      });

    return () => {
      isActive = false;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!autocompleteReady || !line1Ref.current || !window.google?.maps?.places?.Autocomplete) {
      return;
    }

    const autocomplete = new window.google.maps.places.Autocomplete(line1Ref.current, {
      componentRestrictions: { country: countryRestrictions },
      fields: ["address_components"],
      types: ["address"],
    });

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const components = place.address_components ?? [];

      const streetNumber = getComponent(components, "street_number", "long");
      const route = getComponent(components, "route", "long");
      const subpremise = getComponent(components, "subpremise", "long");
      const city =
        getComponent(components, "locality", "long") ||
        getComponent(components, "postal_town", "long") ||
        getComponent(components, "administrative_area_level_3", "long");
      const province = getComponent(components, "administrative_area_level_1", "short");
      const postalCode = [
        getComponent(components, "postal_code", "long"),
        getComponent(components, "postal_code_suffix", "long"),
      ]
        .filter(Boolean)
        .join("-");
      const countryAlpha2 = getComponent(components, "country", "short");
      const country =
        countryCodeFormat === "alpha3" ? alpha3Countries[countryAlpha2] ?? countryAlpha2 : countryAlpha2;
      const line1 = [streetNumber, route].filter(Boolean).join(" ");

      if (line1) setInputValue(names.line1, line1);
      if (subpremise) setInputValue(names.line2, subpremise);
      if (city) setInputValue(names.city, city);
      if (province) setInputValue(names.province, province);
      if (postalCode) setInputValue(names.postal, postalCode);
      if (country) setInputValue(names.country, country);
    });

    return () => listener.remove();
  }, [autocompleteReady, countryCodeFormat, countryRestrictions, names]);

  return (
    <div className={gridClassName}>
      <label className={labelClassName}>
        <span>{mergedLabels.line1}{required?.line1 ? " *" : ""}</span>
        <input
          ref={line1Ref}
          name={names.line1}
          required={required?.line1}
          defaultValue={defaults?.line1 ?? ""}
          maxLength={maxLengths?.line1}
          autoComplete="street-address"
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        <span>{mergedLabels.line2}{required?.line2 ? " *" : ""}</span>
        <input
          name={names.line2}
          required={required?.line2}
          defaultValue={defaults?.line2 ?? ""}
          maxLength={maxLengths?.line2}
          autoComplete="address-line2"
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        <span>{mergedLabels.city}{required?.city ? " *" : ""}</span>
        <input
          name={names.city}
          required={required?.city}
          defaultValue={defaults?.city ?? ""}
          maxLength={maxLengths?.city}
          autoComplete="address-level2"
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        <span>{mergedLabels.province}{required?.province ? " *" : ""}</span>
        <input
          name={names.province}
          required={required?.province}
          defaultValue={defaults?.province ?? ""}
          maxLength={maxLengths?.province}
          autoComplete="address-level1"
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        <span>{mergedLabels.postal}{required?.postal ? " *" : ""}</span>
        <input
          name={names.postal}
          required={required?.postal}
          defaultValue={defaults?.postal ?? ""}
          maxLength={maxLengths?.postal}
          autoComplete="postal-code"
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        <span>{mergedLabels.country}{required?.country ? " *" : ""}</span>
        <input
          name={names.country}
          required={required?.country}
          defaultValue={defaults?.country ?? ""}
          maxLength={maxLengths?.country}
          autoComplete="country"
          className={fieldClassName}
        />
      </label>
    </div>
  );
}
