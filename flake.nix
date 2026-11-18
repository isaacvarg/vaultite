{
  description = "Vaultite: a local knowledge base over a vault of Markdown files";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs:
        let
          inherit (pkgs) lib;
          nodejs = pkgs.nodejs_24; # needs >= 23.6: the server runs .ts files directly
          electron = pkgs.electron_45;
          version = (lib.importJSON ./package.json).version;
        in
        rec {
          default = vaultite;

          vaultite = pkgs.buildNpmPackage {
            pname = "vaultite";
            inherit version nodejs;
            src = lib.cleanSource ./.;

            # Bump after package-lock.json changes: set to lib.fakeHash, build, copy the "got:" hash.
            npmDepsHash = "sha256-56icqP7uvncoAxpx9lhoYJgdThx0AdqhjMjt8fNUfv0=";
            npmDepsFetcherVersion = 2;

            # Use nixpkgs' Electron rather than the one npm would download.
            env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            # The repo's .npmrc already disables install scripts; keep it explicit.
            npmFlags = [ "--ignore-scripts" ];
            makeCacheWritable = true;

            # .npmrc's min-release-age makes npm fetch registry metadata to check publish dates,
            # which the sandbox can't; the lockfile already pins every version.
            postPatch = ''
              sed -i '/^min-release-age/d;/^allow-git/d' .npmrc
            '';

            nativeBuildInputs = [ pkgs.makeWrapper pkgs.copyDesktopItems ];

            # `npm run build`: tsc -b and the Vite build of the web app.
            npmBuildScript = "build";

            installPhase = ''
              runHook preInstall

              npm prune --omit=dev --ignore-scripts --no-audit --no-fund || true

              mkdir -p $out/share/vaultite
              cp -r . $out/share/vaultite
              rm -rf $out/share/vaultite/{.git,ios,screenshots}

              # Machine-local state (trust, caches, file history) defaults to <app>/data, which is
              # the read-only store here. Use the folder a packaged release uses instead:
              # <userData>/local, i.e. ~/.config/Vaultite/local, unless VAULTITE_LOCAL is set.
              localDir='export VAULTITE_LOCAL="''${VAULTITE_LOCAL:-''${VAULTITE_USER_DATA:-''${XDG_CONFIG_HOME:-$HOME/.config}/Vaultite}/local}"'

              # Desktop app (Electron main: electron/shell/boot.mjs)
              makeWrapper ${electron}/bin/electron $out/bin/vaultite \
                --run "$localDir" \
                --add-flags $out/share/vaultite \
                --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}" \
                --set ELECTRON_IS_DEV 0 \
                --inherit-argv0

              # CLI and headless server
              makeWrapper ${nodejs}/bin/node $out/bin/vau \
                --run "$localDir" \
                --add-flags $out/share/vaultite/bin/vau
              makeWrapper ${nodejs}/bin/node $out/bin/vaultite-server \
                --run "$localDir" \
                --add-flags $out/share/vaultite/server.ts

              install -Dm644 web/public/icon-512.png $out/share/icons/hicolor/512x512/apps/vaultite.png

              runHook postInstall
            '';

            desktopItems = [
              (pkgs.makeDesktopItem {
                name = "vaultite";
                desktopName = "Vaultite";
                exec = "vaultite %U";
                icon = "vaultite";
                categories = [ "Office" ];
                mimeTypes = [ "text/markdown" "x-scheme-handler/vaultite" ];
                startupWMClass = "vaultite";
              })
            ];

            meta = {
              description = "Local knowledge base you and your AI write together, in plain Markdown files";
              homepage = "https://vaultite.com";
              license = lib.licenses.asl20;
              mainProgram = "vaultite";
              platforms = lib.platforms.linux;
            };
          };
        });

      apps = forAllSystems (pkgs: {
        default = { type = "app"; program = "${self.packages.${pkgs.system}.vaultite}/bin/vaultite"; };
        server = { type = "app"; program = "${self.packages.${pkgs.system}.vaultite}/bin/vaultite-server"; };
      });

      devShells = forAllSystems (pkgs:
        let
          electron = pkgs.electron_45;
          # `npm run app` flips a fuse in Electron's binary in place, which can't touch the
          # read-only store copy: run the checkout with nixpkgs' Electron directly instead.
          vaultite-dev = pkgs.writeShellScriptBin "vaultite-dev" ''
            root=$(git rev-parse --show-toplevel)
            if [ ! -d "$root/web/dist" ]; then (cd "$root" && npm run build) || exit; fi
            exec ${electron}/bin/electron "$root" "$@"
          '';
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              electron
              vaultite-dev
              pkgs.python3 # node-gyp, if node-pty ever needs a rebuild
              pkgs.git
            ];
            # `npm ci` won't download Electron; anything asking the electron package for its
            # binary gets nixpkgs' one.
            ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            ELECTRON_OVERRIDE_DIST_PATH = "${electron}/libexec/electron";
            shellHook = ''
              echo "vaultite dev shell: node $(node --version), electron ${electron.version}"
              echo "  npm ci && npm run build          install and build"
              echo "  vaultite-dev [--vault <path>]    the desktop app from this checkout"
              echo "  npm start / npm test / npm run check / npm run smoke"
            '';
          };
        });
    };
}
