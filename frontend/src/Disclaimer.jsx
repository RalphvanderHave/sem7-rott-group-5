import React from 'react';
import { Link } from 'react-router-dom';
import './Disclaimer.css';

const Disclaimer = () => {
  return (
    <div className="disclaimer-container">
      <div className="disclaimer-content">
        <div className="disclaimer-header">
          <h1>Disclaimer & Privacyverklaring</h1>
          <h2>Onderzoek “De invloed van een geheugenmodule op empathische communicatie tussen Alfred en alleenstaande senioren”</h2>
        </div>
        
        <div className="disclaimer-body">
          <p>
            Deze website maakt onderdeel uit van het onderzoek “De invloed van een geheugenmodule op empathische communicatie tussen AI-assistent Alfred en alleenstaande senioren”. Wij informeren u hieronder over de omgang met gegevens, de doeleinden van het onderzoek en de relevante wettelijke kaders.
          </p>

          <h3>1. Doel van het onderzoek</h3>
          <p>
            Dit onderzoek richt zich op de vraag hoe een geheugenmodule kan bijdragen aan meer empathische en persoonlijke communicatie tussen de AI-assistent Alfred en alleenstaande senioren. Het betreft uitsluitend wetenschappelijk onderzoek, zonder commerciële of productgerichte doeleinden.
          </p>

          <h3>2. Wettelijk kader – Wetenschappelijk onderzoek en de EU AI Act</h3>
          <p>
            Overeenkomstig Recital 25 van de EU AI Act vallen AI-systemen die specifiek zijn ontwikkeld en gebruikt voor wetenschappelijk onderzoek en ontwikkeling buiten de reikwijdte van de AI-regelgeving, zolang zij niet op de markt worden gebracht of als commercieel product in gebruik worden genomen.
          </p>
          <p>Dit betekent dat:</p>
          <ul>
            <li>dit AI-systeem uitsluitend wordt toegepast in een gecontroleerde onderzoek omgeving,</li>
            <li>de resultaten niet leiden tot commerciële toepassing,</li>
            <li>de AI Act geen beperkingen oplegt aan de onderzoeksfase, zolang het systeem niet in de markt wordt gezet.</li>
          </ul>
          <p>
            Het onderzoek wordt uitgevoerd volgens erkende ethische en professionele normen voor wetenschappelijk onderzoek, in lijn met geldende Europese wet- en regelgeving.
          </p>

          <h3>3. Gebruik van gegevens</h3>
          <p>Tijdens het onderzoek kunnen de volgende gegevens worden verzameld:</p>
          <ul>
            <li>gesprekslogs met Alfred,</li>
            <li>antwoorden op vragenlijsten,</li>
            <li>observaties,</li>
            <li>kwalitatieve feedback.</li>
          </ul>
          <p>Deze gegevens worden:</p>
          <ul>
            <li>uitsluitend gebruikt voor wetenschappelijke doeleinden,</li>
            <li>niet voor commerciële doeleinden ingezet,</li>
            <li>niet met derden gedeeld, tenzij wettelijk vereist.</li>
          </ul>

          <h3>4. Anonimiteit en privacy</h3>
          <ul>
            <li>Alle gegevens worden geanonimiseerd verwerkt.</li>
            <li>Er worden geen namen of andere direct identificeerbare gegevens opgeslagen.</li>
            <li>Gegevens zijn nooit te herleiden tot individuele deelnemers in de rapportage.</li>
          </ul>

          <h3>5. Emotieherkenning – Relevantie van EU AI Act Recital 44</h3>
          <p>
            Het onderzoek maakt gebruik van een AI-systeem dat emoties kan inschatten op basis van spraak.
            Recital 44 van de EU AI Act wijst op zorgen rondom emotieherkenning, met name in onderwijs- en werksituaties, waar machtsongelijkheid en mogelijke nadelige gevolgen een rol spelen. Dit onderzoek vindt niet plaats in een dergelijke context.
          </p>
          <p>Belangrijke waarborgen:</p>
          <ul>
            <li>deelname is vrijwillig,</li>
            <li>emotieherkenning wordt niet gebruikt voor beoordeling, selectie of evaluatie van personen,</li>
            <li>het systeem wordt uitsluitend gebruikt om te onderzoeken hoe empathische communicatie door AI ervaren wordt,</li>
            <li>alle toepassingen blijven binnen een strikt wetenschappelijke en ethische omgeving.</li>
          </ul>
          <p>Daarom valt het onderzoek niet onder de verboden toepassingen zoals genoemd in Recital 44.
          </p>

          <h3>6. Bewaartermijn</h3>
          <p>
            Gegevens worden bewaard zolang noodzakelijk is voor analyse en rapportage en daarna geanonimiseerd of veilig verwijderd.
          </p>

          <h3>7. Vrijwillige deelname</h3>
          <ul>
            <li>Deelname is volledig vrijwillig.</li>
            <li>U kunt op elk moment stoppen zonder opgave van reden.</li>
            <li>Dit heeft geen enkele negatieve consequentie.</li>
          </ul>

          <h3>8. Beveiliging</h3>
          <p>Wij nemen passende beveiligingsmaatregelen, waaronder:</p>
          <ul>
            <li>beveiligde opslag van data,</li>
            <li>beperkte toegang voor onderzoekers,</li>
            <li>veilige verwerking van audio en tekst.</li>
          </ul>

          <h3>9. Contact</h3>
          <p>
            Heeft u vragen over dit onderzoek of over de verwerking van gegevens?<br />
            Neem contact op via:<br />
            [jouw e-mailadres of contactformulier]
          </p>

          <h3>10. Toestemming</h3>
          <p>
            Door deel te nemen aan dit onderzoek of deze website te gebruiken verklaart u dat u deze informatie heeft gelezen en begrepen, en instemt met de verwerking van gegevens zoals hierboven beschreven.
          </p>
        </div>
        
        <div className="back-button-container">
            <Link to="/" className="back-button">Terug naar Home</Link>
        </div>
      </div>
    </div>
  );
};

export default Disclaimer;
