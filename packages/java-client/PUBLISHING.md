# Publishing the ConsentShield Java SDK to Maven Central

Operator runbook. Maven Central artefacts are immutable: once `1.0.0` is released, you cannot overwrite it. Take all the pre-flight gates seriously.

## One-time onboarding (Sonatype OSSRH)

1. **Create a Sonatype Central account** at <https://central.sonatype.com/> using the same GitHub account that owns `github.com/SAnegondhi/consentshield-java`.
2. **Verify the `com.consentshield` namespace** by adding a TXT record on `consentshield.in` per the Sonatype Central instructions. Approval typically lands within 1 business day.
3. **Generate a GPG signing key**:
   ```bash
   gpg --full-generate-key   # RSA 4096, no expiry, your name + a.d.sudhindra@gmail.com
   gpg --list-secret-keys --keyid-format LONG
   ```
   Record the long key ID (e.g. `0x1A2B3C4D5E6F7890`) and back up the secret key offline (export to ASCII-armored file, store on encrypted drive).
4. **Publish the public key** to all three keyservers:
   ```bash
   gpg --keyserver keys.openpgp.org   --send-keys 0x1A2B3C4D5E6F7890
   gpg --keyserver keyserver.ubuntu.com --send-keys 0x1A2B3C4D5E6F7890
   gpg --keyserver pgp.mit.edu          --send-keys 0x1A2B3C4D5E6F7890
   ```
5. **Configure `~/.m2/settings.xml`** with the Sonatype Central token + GPG key id (NEVER check this in):
   ```xml
   <settings>
     <servers>
       <server>
         <id>central</id>
         <username>${env.MAVEN_CENTRAL_TOKEN_USER}</username>
         <password>${env.MAVEN_CENTRAL_TOKEN_PASS}</password>
       </server>
     </servers>
     <profiles>
       <profile>
         <id>release</id>
         <properties>
           <gpg.keyname>0x1A2B3C4D5E6F7890</gpg.keyname>
         </properties>
       </profile>
     </profiles>
   </settings>
   ```

## Pre-flight (every release)

```bash
cd packages/java-client
mvn -B clean verify   # tests pass, JaCoCo >= 80 % via the wrapper module's check rule
```

The version in both `pom.xml` and `wrapper/pom.xml` MUST match the git tag exactly.

## Cut a release tag

```bash
git tag -a v1.0.0 -m "ConsentShield Java SDK 1.0.0"
git push origin v1.0.0
```

The git tag is the source of truth for the release version.

## Stage to Sonatype OSSRH

```bash
cd packages/java-client
mvn -B -P release deploy
```

This signs each artefact with your GPG key and uploads to the staging repository. Verify in the Sonatype Central UI that all six artefacts (jar / sources jar / javadoc jar, each for the wrapper module + the generated module) are present and signed. The validation rules check: POM completeness (`name`, `description`, `url`, `licenses`, `developers`, `scm`), signature validity, sources + javadoc presence.

## Promote to Maven Central

In Sonatype Central UI, click **Publish** on the staged release. Promotion completes in ~30 minutes; the artefact is searchable on `https://central.sonatype.com/` shortly after.

## Smoke install

In a scratch project on a fresh JDK 11 install:

```bash
mvn dependency:get -Dartifact=com.consentshield:consentshield-java-spring-boot-starter:1.0.0
```

Then in `pom.xml`:

```xml
<dependency>
  <groupId>com.consentshield</groupId>
  <artifactId>consentshield-java-spring-boot-starter</artifactId>
  <version>1.0.0</version>
</dependency>
```

`@Autowired ConsentShieldClient` should resolve. Call `client.api().ping(null)` against the live API.

## If a release is broken

**You cannot delete a Maven Central release.** Recovery is to bump the version (`1.0.1`) and ship the fix.

If the broken release was published less than 24 hours ago AND has not been mirrored to Maven Central proper yet (still in the staging promotion window), you can ask Sonatype Central support to drop the staging repository — but do not rely on this. The default assumption is "released = forever".

## v2+ release model

Maven coordinate stays `com.consentshield:consentshield-java-spring-boot-starter`. The version field bumps. Major-version breaks (e.g. dropping JDK 11 baseline, switching from OkHttp to Apache HttpClient) require a v2 ADR, not just a `2.0.0` bump.
